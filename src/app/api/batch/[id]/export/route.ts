import { NextResponse } from "next/server";
import { and, asc, eq, gt } from "drizzle-orm";
import { createNodeMeasurer, loadImageFromFile } from "@/engine/server";
import { db, schema } from "@/db";
import { putBlobStream } from "@/lib/blob";
import { streamBatchZip, type BatchZipDeps } from "@/lib/batchZip";
import { clipartSize } from "@/lib/sets";
import type { SetRow } from "@/db/schema";

const { batches, sets } = schema;

export const dynamic = "force-dynamic";
/**
 * The whole ZIP is one upload, so unlike the tick this cannot be split across invocations: a
 * half-written stream cannot be resumed by a second function. 300 s is Vercel's ceiling for a
 * function on every plan, and a measured set costs a little over a second, so this covers the 200
 * sets the parser allows with room to spare. See the task report for the measurement.
 */
// Next.js reads this without running the file, so it has to be a literal; `TICK_MAX_SECONDS` in
// `processSet.ts` is the value it must equal, and `tests/app/gallery.test.ts` fails if it drifts.
export const maxDuration = 300;

/**
 * The approved sets of a batch, a page at a time.
 *
 * A cursor rather than one `select`: the export holds one set's buffers at a time by design, and
 * reading two hundred rows (each with its input and style JSON) up front would undo that before the
 * first PNG is drawn. Every set of a batch is inserted in one statement, so `created_at` cannot
 * order them — the id does, and it is unique.
 */
async function* approvedSets(batchId: string): AsyncGenerator<SetRow> {
  const PAGE = 20;
  let after: string | null = null;
  for (;;) {
    const rows: SetRow[] = await db
      .select()
      .from(sets)
      .where(and(eq(sets.batchId, batchId), eq(sets.status, "approved"), after ? gt(sets.id, after) : undefined))
      .orderBy(asc(sets.id))
      .limit(PAGE);
    if (rows.length === 0) return;
    for (const row of rows) yield row;
    after = rows[rows.length - 1].id;
    if (rows.length < PAGE) return;
  }
}

const liveDeps = (): BatchZipDeps => ({
  measure: createNodeMeasurer(),
  loadImage: loadImageFromFile,
  clipartSize: src => clipartSize(src),
});

const NOTHING = "Tidak ada set disetujui yang bisa diekspor.";
const TRUNCATED = "Waktu ekspor habis sebelum semua set masuk. ZIP ini belum lengkap, lihat report.csv.";

/**
 * The moment the export must stop taking on new sets: the function's own budget, less a margin for
 * closing the ZIP and finishing the upload. Measured locally at about two seconds a set, so this
 * covers well over a hundred sets — see the task report for where the ceiling actually lands.
 */
const CLOSING_MARGIN_MS = 45_000;

/**
 * Renders every approved set of a batch into one ZIP and stores it.
 *
 * Only a batch the action has already moved to `exporting` is picked up: that flag is what stops a
 * second click — or a retried kick — from rendering the same two hundred sets twice into a second
 * file. Whatever happens, the batch leaves `exporting`: `exported` with a `zipUrl`, or back to
 * `ready` with the reason, so the gallery is never stuck on a spinner.
 *
 * `deps` is a seam for tests only; a live request always gets `liveDeps()`.
 */
export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
  deps: BatchZipDeps = liveDeps(),
) {
  const { id } = await ctx.params;
  const batch = await db.query.batches.findFirst({ where: eq(batches.id, id) });
  if (!batch) return NextResponse.json({ error: "Batch tidak ditemukan." }, { status: 404 });
  if (batch.status !== "exporting") {
    return NextResponse.json({ skipped: true, status: batch.status });
  }

  try {
    const deadline = Date.now() + maxDuration * 1000 - CLOSING_MARGIN_MS;
    const out = await streamBatchZip({ batchId: id, sets: approvedSets(id), deps, put: putBlobStream, deadline });
    if (out.files === 0) {
      await db.update(batches).set({ status: "ready", error: NOTHING, updatedAt: new Date() }).where(eq(batches.id, id));
      return NextResponse.json({ error: NOTHING }, { status: 409 });
    }
    // A partial failure is not an export failure: the ZIP is good and `report.csv` names every
    // missing file, so the batch is `exported` and the header carries the count as a warning.
    const error = out.truncated
      ? TRUNCATED
      : out.failures.length === 0
        ? null
        : `${out.failures.length} bagian gagal diekspor, lihat report.csv di dalam ZIP.`;
    await db.update(batches).set({ status: "exported", zipUrl: out.url, error, updatedAt: new Date() }).where(eq(batches.id, id));
    return NextResponse.json({ url: out.url, files: out.files, failures: out.failures.length, truncated: out.truncated });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[export] batch ${id} failed:`, message);
    await db
      .update(batches)
      .set({ status: "ready", error: "Gagal membuat file ZIP. Coba lagi.", updatedAt: new Date() })
      .where(eq(batches.id, id));
    return NextResponse.json({ error: "Gagal membuat file ZIP." }, { status: 500 });
  }
}
