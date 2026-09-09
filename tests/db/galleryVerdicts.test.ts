import { describe, it, expect, vi, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { unicornSet } from "../fixtures/set-unicorn";
import { liveDb } from "./live";

/**
 * The gallery's verdicts against a real database: what `approveSetsAction` and `rejectSetAction`
 * leave behind on the `batches` row.
 *
 * The roll-up they write is not visible in the gallery itself — the header recomputes its sentence
 * client-side from the rows it polled — but the home page reads `readyCount`/`approvedCount` off
 * the batch row, so a verdict that fails to persist there shows up as a badge that quietly stops
 * moving. That is exactly the bug this file exists to pin: the roll-up must keep being written
 * after the batch has closed to `ready`, and while it is `exporting`.
 *
 * `revalidatePath` is stubbed because a Server Action body called straight from a test has no
 * request context to invalidate; nothing else about these actions is mocked.
 */
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const live = liveDb;
const made: string[] = [];

/** A batch of two `ready` sets, already closed the way a finished tick would leave it. */
async function seed(status: "ready" | "exporting") {
  const { db, schema } = await import("@/db");
  const fixture = unicornSet();
  const batchId = crypto.randomUUID();
  await db.insert(schema.batches).values({
    id: batchId,
    name: "verdicts test",
    status,
    setCount: 2,
    readyCount: 2,
    csvUrl: "https://example.invalid/verdicts.csv",
  });
  const rows = await db
    .insert(schema.sets)
    .values([
      { batchId, status: "ready", input: fixture.input, style: fixture.style },
      { batchId, status: "ready", input: fixture.input, style: fixture.style },
    ])
    .returning({ id: schema.sets.id });
  made.push(batchId);
  return { batchId, setIds: rows.map(r => r.id) };
}

const readBatch = async (id: string) => {
  const { db, schema } = await import("@/db");
  const [row] = await db.select().from(schema.batches).where(eq(schema.batches.id, id));
  return row;
};

afterAll(async () => {
  if (!live || made.length === 0) return;
  const { db, schema } = await import("@/db");
  for (const id of made) {
    await db.delete(schema.sets).where(eq(schema.sets.batchId, id));
    await db.delete(schema.batches).where(eq(schema.batches.id, id));
  }
});

describe.skipIf(!live)("db: gallery verdicts roll up onto the batch", () => {
  it("keeps writing the counts after the batch has closed", async () => {
    // The regression: guarding the whole roll-up UPDATE on `status = 'processing'` made every
    // verdict after the batch closed a silent no-op, and the home page's badge froze.
    const { approveSetsAction, rejectSetAction } = await import("@/app/actions/batches");
    const { batchId, setIds } = await seed("ready");

    const approved = await approveSetsAction([setIds[0]]);
    expect(approved).toEqual({ ok: true, data: { approved: 1 } });
    let batch = await readBatch(batchId);
    expect(batch.approvedCount).toBe(1);
    expect(batch.readyCount).toBe(1);
    expect(batch.status).toBe("ready");

    const rejected = await rejectSetAction(setIds[1]);
    expect(rejected.ok).toBe(true);
    batch = await readBatch(batchId);
    expect(batch.approvedCount).toBe(1);
    expect(batch.readyCount).toBe(0);
    // Each step here is a round trip to a hosted Postgres; the default 5 s is not this test's
    // subject.
  }, 30_000);

  it("starts an export without dropping the ZIP the shop already has", async () => {
    // The wedge: the action used to null `zipUrl` as it flipped to `exporting`, so an export whose
    // kick was lost left the shop with a batch stuck on a spinner *and* nothing downloadable — two
    // hours of rendering recoverable only by hand-editing the row. The previous file stays until
    // the route writes the new one; the gallery hides the link while the export may still be alive.
    const { exportBatchAction } = await import("@/app/actions/batches");
    const { db, schema } = await import("@/db");
    const { batchId, setIds } = await seed("ready");
    const previous = "https://blob.invalid/batches/previous.zip";
    await db.update(schema.batches).set({ zipUrl: previous }).where(eq(schema.batches.id, batchId));
    await db.update(schema.sets).set({ status: "approved" }).where(eq(schema.sets.id, setIds[0]));

    // No route runs behind this: `tickOrigin` answers "" in a test process, so the kick is logged
    // and skipped — which is exactly the lost kick this test is about.
    const res = await exportBatchAction(batchId);
    expect(res).toEqual({ ok: true, data: { started: true } });

    const batch = await readBatch(batchId);
    expect(batch.status).toBe("exporting");
    expect(batch.zipUrl).toBe(previous);
  }, 30_000);

  it("records a verdict during an export without dragging the batch back to ready", async () => {
    const { approveSetsAction } = await import("@/app/actions/batches");
    const { batchId, setIds } = await seed("exporting");

    await approveSetsAction([setIds[0]]);

    const batch = await readBatch(batchId);
    expect(batch.approvedCount).toBe(1);
    expect(batch.readyCount).toBe(1);
    // Only the counts move: an export in flight owns the status until it is finished.
    expect(batch.status).toBe("exporting");
  }, 30_000);

  it("advances only the sets that are ready, whatever ids are passed", async () => {
    const { approveSetsAction, rejectSetAction } = await import("@/app/actions/batches");
    const { batchId, setIds } = await seed("ready");
    await rejectSetAction(setIds[1]);

    // One ready, one already rejected, one that is not a set of this batch at all.
    const res = await approveSetsAction([setIds[0], setIds[1], crypto.randomUUID()]);
    expect(res).toEqual({ ok: true, data: { approved: 1 } });

    const { db, schema } = await import("@/db");
    const rows = await db.select().from(schema.sets).where(eq(schema.sets.batchId, batchId));
    expect(rows.find(r => r.id === setIds[1])!.status).toBe("rejected");
    const batch = await readBatch(batchId);
    expect(batch.approvedCount).toBe(1);
  }, 30_000);
});
