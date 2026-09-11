import { describe, it, expect, vi, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { unicornSet } from "../fixtures/set-unicorn";
import { liveDb } from "./live";

/**
 * Deleting work that is still in flight — the shop's cancel button, spelled as a delete.
 *
 * The guards these pin used to refuse exactly these cases on the grounds that a live function would
 * be left writing to rows that no longer exist. It is the tick and the export route that answer for
 * that now (`tests/db/batchTick.test.ts`, `tests/db/batchExport.test.ts`); what is proven here is
 * that the rows do go, immediately, whatever the server is busy with.
 *
 * `revalidatePath` is stubbed because a Server Action body called straight from a test has no
 * request context to invalidate, and Blob storage because a test database has no files behind it.
 */
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/blob", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/blob")>();
  return { ...actual, deleteBlob: vi.fn(async () => {}), deleteBlobs: vi.fn(async () => {}) };
});

const live = liveDb;
const made: string[] = [];

/** A batch caught mid-flight: one set a tick has claimed, one still waiting its turn. */
async function seed(status: "processing" | "exporting") {
  const { db, schema } = await import("@/db");
  const fixture = unicornSet();
  const batchId = crypto.randomUUID();
  await db.insert(schema.batches).values({
    id: batchId,
    name: "delete in progress test",
    status,
    setCount: 2,
    csvUrl: "https://example.invalid/cancel.csv",
  });
  const rows = await db
    .insert(schema.sets)
    .values([
      { batchId, status: "processing", input: fixture.input, style: fixture.style },
      { batchId, status: "queued", input: fixture.input, style: fixture.style },
    ])
    .returning({ id: schema.sets.id });
  made.push(batchId);
  return { batchId, setIds: rows.map(r => r.id) };
}

const countSets = async (batchId: string) => {
  const { db, schema } = await import("@/db");
  return (await db.select().from(schema.sets).where(eq(schema.sets.batchId, batchId))).length;
};

afterAll(async () => {
  if (!live || made.length === 0) return;
  const { db, schema } = await import("@/db");
  for (const id of made) {
    await db.delete(schema.sets).where(eq(schema.sets.batchId, id));
    await db.delete(schema.batches).where(eq(schema.batches.id, id));
  }
});

describe.skipIf(!live)("db: deleting work that is still in flight", () => {
  it("deletes a batch a tick is still working on, sets and all", async () => {
    const { db, schema } = await import("@/db");
    const { deleteBatchAction } = await import("@/app/actions/batches");
    const { batchId } = await seed("processing");

    const res = await deleteBatchAction(batchId);
    expect(res).toMatchObject({ ok: true, data: { deleted: 2 } });
    expect(await db.select().from(schema.batches).where(eq(schema.batches.id, batchId))).toHaveLength(0);
    expect(await countSets(batchId)).toBe(0);
  }, 30_000);

  it("deletes a batch whose ZIP is still being written", async () => {
    const { db, schema } = await import("@/db");
    const { deleteBatchAction } = await import("@/app/actions/batches");
    const { batchId } = await seed("exporting");

    const res = await deleteBatchAction(batchId);
    expect(res).toMatchObject({ ok: true });
    expect(await db.select().from(schema.batches).where(eq(schema.batches.id, batchId))).toHaveLength(0);
  }, 30_000);

  it("deletes a single set a tick has already claimed", async () => {
    const { deleteSetsAction } = await import("@/app/actions/batches");
    const { batchId, setIds } = await seed("processing");

    const res = await deleteSetsAction([setIds[0]]);
    expect(res).toMatchObject({ ok: true, data: { deleted: 1 } });
    expect(await countSets(batchId)).toBe(1);
  }, 30_000);
});
