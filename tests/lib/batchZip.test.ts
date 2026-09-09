import { describe, it, expect, vi, beforeEach } from "vitest";
import sharp from "sharp";
import { unzipSync, strFromU8 } from "fflate";
import { streamBatchZip, type BatchZipDeps } from "@/lib/batchZip";
import { clipartSize } from "@/lib/sets";
import { fetchRemoteImage } from "@/lib/remoteImage";
import { createNodeMeasurer, loadImageFromFile } from "@/engine/server";
import type { SetRow } from "@/db/schema";
import { parseBatchRows } from "@/lib/csv";
import { unicornSet } from "../fixtures/set-unicorn";

// No test may reach the network: the broken set below names a remote clipart on purpose.
vi.mock("@/lib/remoteImage", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/remoteImage")>();
  return { ...actual, fetchRemoteImage: vi.fn(actual.fetchRemoteImage) };
});
const mockedFetch = vi.mocked(fetchRemoteImage);

beforeEach(() => {
  mockedFetch.mockReset();
  mockedFetch.mockRejectedValue(new Error("no network in tests"));
});

const DPI = 300;
const cm = (px: number) => (px / DPI) * 2.54;
/** Spec §4: the printed longest side per size class. */
const LIMIT_CM: Record<string, number> = { adult: 29, "kids-1-9": 20, "kids-0-1": 18 };

/** A `sets` row with only the columns the export reads filled in for real. */
function setRow(over: Partial<SetRow> & { id: string }): SetRow {
  const base = unicornSet();
  return {
    batchId: "b1",
    status: "approved",
    input: { ...base.input, members: base.input.members.filter(m => m.id === "ayah" || m.id === "kid") },
    style: base.style,
    aiFallback: false,
    error: null,
    memberStates: null,
    exportUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as SetRow;
}

/** A `put` that drains the stream the way Blob storage would, remembering how it arrived. */
function collectingPut() {
  const chunks: Uint8Array[] = [];
  const put = vi.fn(async (path: string, body: ReadableStream<Uint8Array>) => {
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      // A real upload is slower than the renderer; the pause is what makes backpressure observable.
      await new Promise(r => setTimeout(r, 0));
    }
    return `https://blob.test/${path}`;
  });
  return { put, chunks, buffer: () => Buffer.concat(chunks.map(c => Buffer.from(c))) };
}

const deps = (): BatchZipDeps => ({
  measure: createNodeMeasurer(),
  loadImage: loadImageFromFile,
  clipartSize: src => clipartSize(src),
});

async function* iterate(rows: SetRow[]) {
  for (const row of rows) yield row;
}

describe("streamBatchZip", () => {
  it("writes one folder per set, a PNG per member within its size limit, and a report", async () => {
    const rows = [
      // Named by its sku prefix when the row carries one — parsed from a real CSV line, so this
      // fails if the column stops being carried through `csv.ts` or the schema strips it again.
      setRow({ id: "s1", input: { ...parseBatchRows("kid_name,age,theme,members,sku_prefix\nKeisya,5,unicorn,Ayah:adult;Keisya:kid,KEI\n").rows[0].input, members: setRow({ id: "x" }).input.members } }),
      // No prefix: named from the kid, and it collides with the third set.
      setRow({ id: "s2" }),
      setRow({ id: "s3" }),
      // Its clipart cannot be read at all, so the whole set is dropped with a reason.
      setRow({ id: "s4", style: { ...unicornSet().style, clipartSrc: "https://cdn.test/gone.png" } }),
    ];
    // The last set's members must not take the good sets down with them.
    rows[2].input = { ...rows[2].input, members: rows[2].input.members.map(m => (m.id === "ayah" ? { ...m, overrides: { clipart: { src: "/etc/passwd" } } } : m)) };

    const { put, chunks, buffer } = collectingPut();
    const out = await streamBatchZip({ batchId: "b1", sets: iterate(rows), deps: deps(), put });

    expect(out.url).toBe("https://blob.test/batches/b1.zip");
    expect(put).toHaveBeenCalledTimes(1);
    // It really streamed: the upload saw many chunks rather than one finished buffer.
    expect(chunks.length).toBeGreaterThan(1);

    const files = unzipSync(new Uint8Array(buffer()));
    const names = Object.keys(files).sort();
    expect(names).toContain("report.csv");
    expect(names).toContain("KEI/Ayah.png");
    expect(names).toContain("KEI/Keisya.png");
    expect(names).toContain("Keisya/Ayah.png");
    // The second Keisya gets a suffix rather than overwriting the first.
    expect(names).toContain("Keisya-2/Keisya.png");
    // The set whose clipart could not be read contributes nothing but the report line.
    expect(names.filter(n => n.endsWith(".png"))).toHaveLength(out.files);
    // The member with the refused override is skipped; its sibling is still exported.
    expect(names).not.toContain("Keisya-2/Ayah.png");

    for (const name of names.filter(n => n.endsWith(".png"))) {
      const png = Buffer.from(files[name]);
      const { width = 0, height = 0, channels, format } = await sharp(png).metadata();
      expect(format).toBe("png");
      expect(channels).toBe(4); // transparent background, not flattened onto white
      const limit = LIMIT_CM[name.endsWith("/Ayah.png") ? "adult" : "kids-1-9"];
      expect(Math.max(cm(width), cm(height)), name).toBeLessThanOrEqual(limit + 0.01);
    }

    const report = strFromU8(files["report.csv"]);
    const lines = report.trim().split("\n");
    expect(lines[0]).toBe("set_id,folder,kid_name,member,status,error");
    // Every set is accounted for, the failed one included.
    for (const id of ["s1", "s2", "s3", "s4"]) expect(report).toContain(id);
    expect(lines.find(l => l.startsWith("s4,"))).toMatch(/failed/);
    expect(out.failures.map(f => f.set)).toContain("s4");
    expect(out.failures.some(f => f.set === "s3" && f.member === "Ayah")).toBe(true);
  }, 300_000);

  it("keeps going when a set has no style yet", async () => {
    const { put, buffer } = collectingPut();
    const rows = [setRow({ id: "n1", style: null }), setRow({ id: "n2" })];
    const out = await streamBatchZip({ batchId: "b2", sets: iterate(rows), deps: deps(), put });
    const files = unzipSync(new Uint8Array(buffer()));
    expect(Object.keys(files).filter(n => n.endsWith(".png"))).toHaveLength(2);
    expect(out.failures.map(f => f.set)).toEqual(["n1"]);
    expect(strFromU8(files["report.csv"])).toContain("n1");
  }, 300_000);

  it("closes the ZIP at the deadline instead of being killed with it half written", async () => {
    const { put, buffer } = collectingPut();
    const rows = [setRow({ id: "d1" }), setRow({ id: "d2" })];
    // A deadline already past: not one set is started, but the file itself is still valid.
    const out = await streamBatchZip({ batchId: "b4", sets: iterate(rows), deps: deps(), put, deadline: Date.now() - 1 });
    expect(out.truncated).toBe(true);
    expect(out.files).toBe(0);
    const report = strFromU8(unzipSync(new Uint8Array(buffer()))["report.csv"]);
    expect(report).toContain("truncated");
  }, 60_000);

  it("does not park forever on an upload that stopped reading", async () => {
    // A consumer that never pulls: without a deadline inside `drain` the export would sit here for
    // the whole budget and be killed with nothing written.
    const put = vi.fn(async () => "https://blob.test/stalled.zip");
    const rows = [setRow({ id: "p1" }), setRow({ id: "p2" }), setRow({ id: "p3" })];
    const started = Date.now();
    const out = await streamBatchZip({ batchId: "b5", sets: iterate(rows), deps: deps(), put, deadline: Date.now() + 500 });
    expect(out.truncated).toBe(true);
    expect(out.url).toBe("https://blob.test/stalled.zip");
    // It gave up near its deadline rather than rendering every set into a stream nobody is reading.
    expect(Date.now() - started).toBeLessThan(20_000);
  }, 60_000);

  it("escapes a comma and a quote in the report rather than shifting its columns", async () => {
    const { put, buffer } = collectingPut();
    const row = setRow({ id: "q1", style: null });
    row.input = { ...row.input, kidName: 'Ke, "si" ya' };
    await streamBatchZip({ batchId: "b3", sets: iterate([row]), deps: deps(), put });
    const report = strFromU8(unzipSync(new Uint8Array(buffer()))["report.csv"]);
    expect(report).toContain('"Ke, ""si"" ya"');
    expect(report.trim().split("\n")).toHaveLength(2);
  }, 60_000);
});
