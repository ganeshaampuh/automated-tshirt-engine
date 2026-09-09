import { Zip, ZipPassThrough, strToU8 } from "fflate";
import { applyOverrides, collage, SetSchema, type Member, type SetInput, type TemplateContext, type TextMeasurer } from "@/engine";
import { exportPrintPng, type RenderOpts } from "@/engine/server";
import type { SetRow } from "@/db/schema";
import { guardRemoteImages, newByteCache, type ClipartSize } from "@/lib/sets";
import { RemoteImageError } from "@/lib/remoteImage";

export type BatchZipDeps = {
  measure: TextMeasurer;
  loadImage: RenderOpts["loadImage"];
  clipartSize: (src: string) => Promise<ClipartSize>;
};

export type ZipFailure = { set: string; member?: string; error: string };
export type BatchZipResult = { url: string; files: number; failures: ZipFailure[]; truncated: boolean };

const SET_UNRENDERED = "Set ini belum digambar.";
const SET_CLIPART = "Clipart set ini tidak bisa dibaca.";
const MEMBER_FAILED = "Gagal membuat file cetak untuk anggota ini.";

/** Filesystem/zip-safe slug that keeps non-ASCII letters (Indonesian names). */
const slug = (s: string) => s.trim().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");

/** An expected failure's own Indonesian sentence, or the generic one for this step. */
const reason = (e: unknown, fallback: string) => (e instanceof RemoteImageError ? e.message : fallback);

/**
 * The folder a set's PNGs go in: its `sku_prefix` when the row carries one, else the kid's name.
 *
 * `SetInputSchema` has no `sku_prefix` field yet, so today every folder is named from the kid; the
 * column is read off the stored JSON directly so that wiring it through the parser is the only
 * change needed, not a second pass over the export.
 */
function folderFor(input: SetInput): string {
  const raw = (input as SetInput & { skuPrefix?: unknown }).skuPrefix;
  const sku = typeof raw === "string" ? slug(raw) : "";
  return sku !== "" ? sku : slug(input.kidName) || "set";
}

/** `Keisya`, then `Keisya-2`: two families with the same kid and no sku must not overwrite each other. */
function uniqueFolder(base: string, taken: Map<string, number>): string {
  const n = (taken.get(base) ?? 0) + 1;
  taken.set(base, n);
  return n === 1 ? base : `${base}-${n}`;
}

const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const csvRow = (cells: string[]) => cells.map(csvCell).join(",") + "\n";

/**
 * A ZIP that is written while it is being uploaded.
 *
 * `Zip` hands each entry's bytes to `ondata` as they are pushed, so the stream carries a set's PNGs
 * away while the next set is still rendering and nothing accumulates. `drain` is the other half of
 * that promise: without waiting for the consumer to ask for more, a slow upload would let the
 * queued chunks grow into exactly the gigabyte of buffers streaming is here to avoid.
 */
function zipStream() {
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let wake: (() => void) | null = null;
  let failure: Error | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    pull() {
      const w = wake;
      wake = null;
      w?.();
    },
    cancel(e) {
      // The upload gave up; stop the renderer at the next set rather than drawing into a dead pipe.
      failure = e instanceof Error ? e : new Error(String(e));
      const w = wake;
      wake = null;
      w?.();
    },
  });

  const zip = new Zip((err, data, final) => {
    if (err) {
      failure = err;
      controller.error(err);
      return;
    }
    controller.enqueue(data);
    if (final) controller.close();
  });

  return {
    stream,
    /** Adds one whole file. `ZipPassThrough` stores it as-is: a PNG is already deflated. */
    file(name: string, data: Uint8Array) {
      const entry = new ZipPassThrough(name);
      zip.add(entry);
      entry.push(data, true);
    },
    end: () => zip.end(),
    /** Resolves once the consumer wants more bytes, so only one set is ever in flight. */
    async drain() {
      if (failure) throw failure;
      const room = controller.desiredSize;
      if (room === null || room > 0) return;
      await new Promise<void>(resolve => (wake = resolve));
      if (failure) throw failure;
    },
  };
}

/**
 * Streams one folder per approved set — `<sku or kid>/<label>.png` — plus a `report.csv` listing
 * every set and member with its status, straight into Blob storage.
 *
 * Nothing is accumulated: one set's designs are rendered, pushed and released before the next row is
 * read, because a single full-resolution set peaks near 380 MB and two hundred of them would exhaust
 * any function. A member that will not render is written into the report and skipped, and so is a
 * whole set that has no usable style — a batch of two hundred must not be lost to one bad row.
 */
export async function streamBatchZip(opts: {
  batchId: string;
  sets: AsyncIterable<SetRow>;
  deps: BatchZipDeps;
  put: (path: string, body: ReadableStream<Uint8Array>, contentType: string) => Promise<string>;
  /** Epoch ms after which no further set is started, so the ZIP is closed rather than cut off. */
  deadline?: number;
}): Promise<BatchZipResult> {
  const { batchId, sets, deps, put, deadline } = opts;
  const zip = zipStream();
  const failures: ZipFailure[] = [];
  const taken = new Map<string, number>();
  let report = csvRow(["set_id", "folder", "kid_name", "member", "status", "error"]);
  let files = 0;
  let truncated = false;

  // Started before anything is rendered: the upload has to be pulling for the stream to move.
  const uploaded = put(`batches/${batchId}.zip`, zip.stream, "application/zip");
  // A `put` that rejects while the loop below is still pushing would otherwise be an unhandled
  // rejection; the loop learns about it through `drain` (the stream is cancelled) and rethrows.
  uploaded.catch(() => {});

  const note = (row: SetRow, folder: string, member: string, status: string, error: string) => {
    report += csvRow([row.id, folder, row.input?.kidName ?? "", member, status, error]);
  };

  try {
    for await (const row of sets) {
      // A function that is killed mid-upload leaves no ZIP at all and a batch stuck in `exporting`.
      // Stopping one set short of the budget instead means the shop gets a valid file plus a report
      // line naming what is missing.
      if (deadline !== undefined && Date.now() >= deadline) {
        truncated = true;
        report += csvRow(["", "", "", "", "truncated", "Batas waktu ekspor tercapai; sisa set belum masuk ZIP."]);
        break;
      }
      await zip.drain();
      const parsed = SetSchema.safeParse({ input: row.input, style: row.style });
      if (!parsed.success) {
        failures.push({ set: row.id, error: SET_UNRENDERED });
        note(row, "", "", "failed", SET_UNRENDERED);
        continue;
      }
      const set = parsed.data;

      // One cache per set: the clipart is read for its size and then once per member, and a remote
      // src must not be fetched five times over.
      const cache = newByteCache();
      let ctx: TemplateContext;
      try {
        ctx = { measure: deps.measure, clipart: await deps.clipartSize(set.style.clipartSrc) };
      } catch (e) {
        const error = reason(e, SET_CLIPART);
        failures.push({ set: row.id, error });
        note(row, "", "", "failed", error);
        continue;
      }

      const folder = uniqueFolder(folderFor(row.input), taken);
      const loadImage = guardRemoteImages(deps.loadImage, cache);
      const labels = new Map<string, number>();
      for (const member of set.input.members) {
        // Built per member rather than through `expand`, which maps them all at once: one broken
        // override must not cost the rest of the family their files.
        const name = `${folder}/${uniqueFolder(slug(member.label) || member.id, labels)}.png`;
        try {
          zip.file(name, new Uint8Array(await renderMember(set, member, ctx, loadImage)));
          files += 1;
          note(row, folder, member.label, "ok", "");
        } catch (e) {
          const error = reason(e, MEMBER_FAILED);
          console.error(`[batchZip] member ${member.id} of set ${row.id} failed:`, e instanceof Error ? e.message : e);
          failures.push({ set: row.id, member: member.label, error });
          note(row, folder, member.label, "failed", error);
        }
        await zip.drain();
      }
    }

    zip.file("report.csv", strToU8(report));
    zip.end();
  } catch (e) {
    zip.end();
    await uploaded.catch(() => {});
    throw e;
  }

  return { url: await uploaded, files, failures, truncated };
}

/** One member's print-ready PNG, transparent and already cropped to its safe printed size. */
async function renderMember(
  set: { input: SetInput; style: NonNullable<SetRow["style"]> },
  member: Member,
  ctx: TemplateContext,
  loadImage: RenderOpts["loadImage"],
): Promise<Buffer> {
  const design = applyOverrides(collage(set, member, ctx), member.overrides);
  const { png } = await exportPrintPng(design, loadImage);
  return png;
}
