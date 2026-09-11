import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import type { AIProvider } from "@/ai";
import { createNodeMeasurer, loadImageFromFile } from "@/engine/server";
import type { ProcessDeps } from "@/lib/processSet";
import { liveDb } from "./live";

// `deleteBlobs` is the one thing the cancel path reaches for directly rather than through `deps`,
// and a test database has no Blob store behind it. Spied, not stubbed out: every other export of
// the module keeps its real implementation.
vi.mock("@/lib/blob", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/blob")>();
  return { ...actual, deleteBlobs: vi.fn(async () => {}) };
});

/**
 * The whole chain against a real database: a batch of four sets — one more than a tick's `TICK_BATCH`
 * of three — driven until it reports no work left.
 *
 * The re-invocation itself is a `fetch` to this app's own origin, which does not exist in a test
 * process — `tickOrigin` answers "" here, the route logs that and skips the kick, and this test
 * plays the part of the chain by calling the route again while it reports work remaining. What is
 * proven is everything the chain depends on: the claim, the per-set writes, the roll-up, the
 * `remaining` figure the next tick is started from, and the final `ready` verdict.
 *
 * The AI provider and the blob store are stubbed through the route's `deps` seam. A live provider
 * would spend a vision call and an LLM call per set, which is minutes of real network for a test
 * about SQL; the AI path is covered by the mocked-provider unit tests in
 * `tests/lib/processSet.test.ts`. Every row also carries a `data:` clipart, so nothing is fetched.
 */
async function smallClipart(): Promise<string> {
  // Small on purpose: the CSV may only name an https or data: image, and a full-size data: URL would
  // put a third of a megabyte into every row's `input` JSON.
  const png = await sharp(readFileSync("tests/fixtures/unicorn.png")).resize(96, 96, { fit: "inside" }).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

/** The fixture with a `clipart_url` column added, repeated until the batch needs several ticks. */
function csvWithClipart(clipartDataUrl: string, copies: number): string {
  const [header, ...body] = readFileSync("tests/fixtures/batch-sample.csv", "utf8").trim().split("\n");
  // Quoted: a data: URL contains a comma, which an unquoted CSV field would truncate.
  const rows: string[] = [];
  for (let i = 0; i < copies; i++) for (const line of body) rows.push(`${line},"${clipartDataUrl}"`);
  return [`${header},clipart_url`, ...rows].join("\n");
}

/** In-process stand-ins for the two things a tick would otherwise reach the network for. */
function stubDeps(): ProcessDeps {
  const provider = {
    // `describeClipart` sends images and `chooseStyle` does not, which tells the two calls apart.
    chatJSON: vi.fn(async ({ images }: { images?: string[] }) =>
      images?.length
        ? { caption: "gambar lucu", kind: "illustration" }
        : {
            font: "Fredoka",
            palette: { primary: "#e6007e", secondary: "#f9a8d4", outline: "#222222" },
            rationale: "cocok untuk anak",
          },
    ),
    generateImage: vi.fn(async () => readFileSync("tests/fixtures/unicorn.png")),
  } as unknown as AIProvider;
  return {
    provider,
    putBlob: vi.fn(async (path: string) => `https://blob.test/${path}`),
    measure: createNodeMeasurer(),
    loadImage: loadImageFromFile,
  };
}

describe.skipIf(!liveDb)("POST /api/batch/[id]/tick", () => {
  it("processes every set of a batch across ticks and leaves none processing", async () => {
    const { eq } = await import("drizzle-orm");
    const { db, schema } = await import("@/db");
    const { parseBatchRows } = await import("@/lib/csv");
    const { rowsToInserts } = await import("@/lib/batchInserts");
    const { POST } = await import("@/app/api/batch/[id]/tick/route");

    const { rows, errors } = parseBatchRows(csvWithClipart(await smallClipart(), 2));
    expect(errors).toEqual([]);
    // Four sets against a `TICK_BATCH` of three: the smallest batch that needs a second tick, which
    // is the whole point of the chain.
    const wanted = rows.slice(0, 4);

    const id = crypto.randomUUID();
    await db.batch([
      db.insert(schema.batches).values({ id, name: "tick test", status: "processing", setCount: wanted.length, csvUrl: "https://blob.test/none.csv" }),
      db.insert(schema.sets).values(rowsToInserts(id, wanted)),
    ]);

    const tick = async (batchId: string) => {
      const res = await POST(
        new Request(`http://localhost:3000/api/batch/${batchId}/tick`, { method: "POST" }),
        { params: Promise.resolve({ id: batchId }) },
        stubDeps(),
      );
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    };

    try {
      const seen: { processed: unknown; remaining: unknown }[] = [];
      for (let i = 0; i < 5; i++) {
        const { body } = await tick(id);
        seen.push({ processed: body.processed, remaining: body.remaining });
        if (body.remaining === 0) break;
      }
      // Four sets, three per tick: the first tick must have reported work still queued.
      expect(seen.length).toBeGreaterThan(1);
      expect(seen[0]).toEqual({ processed: 3, remaining: 1 });
      expect(seen.at(-1)?.remaining).toBe(0);

      const after = await db.select().from(schema.sets).where(eq(schema.sets.batchId, id));
      expect(after).toHaveLength(wanted.length);
      for (const row of after) {
        expect(["ready", "failed"]).toContain(row.status);
        if (row.status === "failed") expect(row.error).toBeTruthy();
        else {
          expect(row.style).toBeTruthy();
          for (const state of Object.values(row.memberStates ?? {})) {
            if (state.status === "ready") expect(state.previewUrl).toBeTruthy();
            else expect(state.error).toBeTruthy();
          }
        }
      }
      expect(after.some(r => r.status === "processing")).toBe(false);

      const [batch] = await db.select().from(schema.batches).where(eq(schema.batches.id, id));
      expect(batch.status).toBe("ready");
      expect(batch.readyCount + batch.failedCount).toBe(wanted.length);

      // A finished batch is not reopened by a stale kick.
      const late = await tick(id);
      expect(late.body).toMatchObject({ processed: 0, remaining: 0, skipped: true });
    } finally {
      await db.delete(schema.sets).where(eq(schema.sets.batchId, id));
      await db.delete(schema.batches).where(eq(schema.batches.id, id));
    }
  }, 90_000);

  /**
   * The cancel path: the shop deletes the batch while a tick is rendering it.
   *
   * There is no way to kill a function from outside, so the tick has to notice for itself. The
   * delete is staged from inside `putBlob` — the moment the tick is provably mid-set — which is as
   * close to the real race as a test can stand.
   */
  it("throws its work away and cleans up its uploads when the batch is deleted mid-tick", async () => {
    const { eq } = await import("drizzle-orm");
    const { db, schema } = await import("@/db");
    const { parseBatchRows } = await import("@/lib/csv");
    const { rowsToInserts } = await import("@/lib/batchInserts");
    const { deleteBlobs } = await import("@/lib/blob");
    const { POST } = await import("@/app/api/batch/[id]/tick/route");

    const { rows } = parseBatchRows(csvWithClipart(await smallClipart(), 1));
    const wanted = rows.slice(0, 1);
    const id = crypto.randomUUID();
    await db.batch([
      db.insert(schema.batches).values({ id, name: "cancel test", status: "processing", setCount: 1, csvUrl: "https://blob.test/none.csv" }),
      db.insert(schema.sets).values(rowsToInserts(id, wanted)),
    ]);

    const uploaded: string[] = [];
    const deps = stubDeps();
    let deleted = false;
    deps.putBlob = vi.fn(async (path: string) => {
      // The first upload is a member preview, so by here the tick is committed to this set.
      if (!deleted) {
        deleted = true;
        await db.delete(schema.sets).where(eq(schema.sets.batchId, id));
        await db.delete(schema.batches).where(eq(schema.batches.id, id));
      }
      const url = `https://blob.test/${path}`;
      uploaded.push(url);
      return url;
    });

    try {
      const res = await POST(
        new Request(`http://localhost:3000/api/batch/${id}/tick`, { method: "POST" }),
        { params: Promise.resolve({ id }) },
        deps,
      );
      expect(await res.json()).toMatchObject({ cancelled: true });
      expect(uploaded.length).toBeGreaterThan(0);
      // Every file this tick put in the store is handed back for removal; nothing is left pointing
      // at a row that no longer exists.
      expect(deleteBlobs).toHaveBeenCalledWith(expect.arrayContaining(uploaded));
    } finally {
      await db.delete(schema.sets).where(eq(schema.sets.batchId, id));
      await db.delete(schema.batches).where(eq(schema.batches.id, id));
    }
  }, 90_000);

  it("404s for a batch that does not exist", async () => {
    const { POST } = await import("@/app/api/batch/[id]/tick/route");
    const id = crypto.randomUUID();
    const res = await POST(new Request(`http://localhost:3000/api/batch/${id}/tick`, { method: "POST" }), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(404);
  }, 30_000);
});
