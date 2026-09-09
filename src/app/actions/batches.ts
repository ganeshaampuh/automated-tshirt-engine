"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { waitUntil } from "@vercel/functions";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { strandedSets } from "@/db/claimSets";
import { approvable, isUnderway } from "@/app/batch/[id]/galleryRules";
import { action, ActionError, type ActionResult } from "@/lib/actionResult";
import { deleteBlob, putBlob } from "@/lib/blob";
import { rowsToInserts } from "@/lib/batchInserts";
import { parseBatchRows, type ParsedRow, type RowError } from "@/lib/csv";
import { initialStates } from "@/lib/memberState";
import { STALE_CLAIM_MINUTES, TICK_MAX_SECONDS } from "@/lib/processSet";
import { tickOrigin } from "@/lib/tickOrigin";
import { MAX_CSV_MESSAGE, MAX_UPLOAD_BYTES } from "@/lib/upload";

const { batches, sets } = schema;

function fail(context: string, cause?: unknown): never {
  if (cause !== undefined) console.error(`[batches] ${context}:`, cause instanceof Error ? cause.message : cause);
  throw new ActionError(context);
}

type Upload = { name: string; text: string; bytes: Buffer };

/** The browser checks the size too, but a Server Action is a public POST and cannot trust it. */
async function readUpload(form: FormData): Promise<Upload> {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) fail("Pilih file CSV dulu.");
  if (file.size > MAX_UPLOAD_BYTES) fail(MAX_CSV_MESSAGE);
  const bytes = Buffer.from(await file.arrayBuffer());
  // A UTF-8 BOM is what Excel writes; left in place it would hide inside the first header name.
  const text = bytes.toString("utf8").replace(/^﻿/, "");
  return { name: file.name, text, bytes };
}

const countMembers = (rows: ParsedRow[]) => rows.reduce((n, r) => n + r.input.members.length, 0);

/** A dry run: it reads the file, reports what it found, and writes nothing anywhere. */
export async function validateCsvAction(
  form: FormData,
): Promise<ActionResult<{ rows: number; members: number; errors: RowError[] }>> {
  return action(async () => {
    const { text } = await readUpload(form);
    const { rows, errors } = parseBatchRows(text);
    return { rows: rows.length, members: countMembers(rows), errors };
  });
}

/**
 * The origin the tick is called on. `tickOrigin` prefers what Vercel set and reads the request's
 * headers only under `next dev`; see there for why the obvious precedence is the wrong one.
 */
async function requestOrigin(): Promise<string> {
  if (process.env.NODE_ENV !== "development") return tickOrigin(process.env);
  const h = await headers();
  return tickOrigin(process.env, { host: h.get("host"), proto: h.get("x-forwarded-proto") });
}

/**
 * Starts the processing chain without waiting for it.
 *
 * A failed kick is logged and swallowed on purpose: the batch is already durable, and the gallery's
 * "Lanjutkan" button starts a fresh chain. Creation must not fail because the tick did.
 */
function kickTick(origin: string, id: string) {
  kick(origin, id, "tick");
}

/** Fires one of this batch's long routes and forgets it; the database carries the result. */
function kick(origin: string, id: string, route: "tick" | "export") {
  if (origin === "") {
    console.error(`[batches] no origin for the ${route} of ${id}; it waits for a manual resume`);
    return;
  }
  waitUntil(
    fetch(`${origin}/api/batch/${id}/${route}`, { method: "POST" }).then(
      res => {
        if (!res.ok) console.error(`[batches] ${route} for ${id} answered ${res.status}`);
      },
      e => console.error(`[batches] ${route} for ${id} failed:`, e instanceof Error ? e.message : e),
    ),
  );
}

/**
 * Creates a batch from a validated CSV. Refuses outright while any row is broken, so a shop never
 * ends up with a batch that is missing the rows it thought it uploaded.
 */
export async function createBatchFromCsvAction(form: FormData): Promise<ActionResult<{ id: string }>> {
  return action(async () => {
    const { name, text, bytes } = await readUpload(form);
    const { rows, errors } = parseBatchRows(text);
    if (errors.length > 0) {
      fail(`CSV masih punya ${errors.length} baris bermasalah. Perbaiki dulu, lalu unggah lagi.`);
    }
    if (rows.length === 0) fail("Tidak ada baris data di file CSV.");

    let csvUrl: string;
    try {
      csvUrl = await putBlob(`batches/${Date.now()}.csv`, bytes, "text/csv; charset=utf-8");
    } catch (e) {
      fail("Gagal menyimpan file CSV.", e);
    }

    // The id is minted here rather than by the database so both inserts can go in one batch: the
    // sets need the batch id, and neon-http has no interactive `db.transaction` to read it back in.
    const id = crypto.randomUUID();
    try {
      // `db.batch` sends both statements to Neon's transaction endpoint, so a failed set insert
      // rolls the batch row back with it and never leaves half a batch behind.
      await db.batch([
        db.insert(batches).values({
          id,
          name: name.trim() === "" ? `Batch ${new Date().toISOString()}` : name.trim(),
          status: "processing",
          setCount: rows.length,
          csvUrl,
        }),
        db.insert(sets).values(rowsToInserts(id, rows)),
      ]);
    } catch (e) {
      // The CSV is already in Blob storage and now belongs to no batch, so take it back out.
      await deleteBlob(csvUrl);
      fail("Gagal membuat batch.", e);
    }

    kickTick(await requestOrigin(), id);
    revalidatePath("/");
    return { id };
  });
}

/**
 * Recomputes a batch's roll-up from its sets, so the home page's figures match the cards after a
 * verdict, and closes a batch that has nothing left to do.
 *
 * Two statements on purpose. The counts must be written whatever state the batch is in — the home
 * page reads them long after a batch has closed, and a verdict recorded then still has to show up.
 * Only the `ready` transition is conditional, because a batch that has moved on to `exporting` or
 * `exported` must not be dragged back. Guarding the single UPDATE on `processing` instead froze the
 * counts at the moment the batch first closed.
 *
 * The closing itself heals a tick that died between its per-set writes and its own roll-up, which
 * leaves the batch at `processing` with no set queued or processing and no later tick able to
 * resolve it.
 */
async function refreshCounts(batchId: string) {
  const rows = await db
    .select({ status: sets.status, n: sql<number>`count(*)::int` })
    .from(sets)
    .where(eq(sets.batchId, batchId))
    .groupBy(sets.status);
  const n = (status: string) => rows.find(r => r.status === status)?.n ?? 0;

  await db
    .update(batches)
    .set({
      readyCount: n("ready"),
      approvedCount: n("approved"),
      failedCount: n("failed"),
      updatedAt: new Date(),
    })
    .where(eq(batches.id, batchId));

  if (n("queued") + n("processing") === 0) {
    await db
      .update(batches)
      .set({ status: "ready", updatedAt: new Date() })
      .where(and(eq(batches.id, batchId), eq(batches.status, "processing")));
  }
}

/** The batch a set belongs to, and its current status — what every verdict below has to read first. */
async function loadSet(id: string) {
  const row = await db.query.sets
    .findFirst({ where: eq(sets.id, id), columns: { id: true, batchId: true, status: true, input: true } })
    .catch(e => fail("Gagal membaca set ini.", e));
  if (!row) fail("Set ini tidak ada.");
  return row;
}

/**
 * Approves the sets the shop ticked.
 *
 * `approvable` decides which ids actually move: only sets that are `ready` this moment. A checkbox
 * can be stale — the set failed since the page loaded, another tab already approved it — and
 * advancing one of those would either bless artwork that was never rendered or count an approval
 * twice. Such ids are dropped silently and the answer says how many really moved.
 */
export async function approveSetsAction(ids: string[]): Promise<ActionResult<{ approved: number }>> {
  return action(async () => {
    const wanted = [...new Set(ids)];
    if (wanted.length === 0) return { approved: 0 };
    const rows = await db
      .select({ id: sets.id, status: sets.status, batchId: sets.batchId })
      .from(sets)
      .where(inArray(sets.id, wanted))
      .catch(e => fail("Gagal membaca set ini.", e));

    const moving = approvable(wanted, rows);
    if (moving.length === 0) return { approved: 0 };
    // Guarded on `ready` in SQL too: between the read above and this write another tab may have
    // moved the same set, and the database is the only place that can settle the race.
    await db
      .update(sets)
      .set({ status: "approved", updatedAt: new Date() })
      .where(and(inArray(sets.id, moving), eq(sets.status, "ready")))
      .catch(e => fail("Gagal menyetujui set.", e));

    const batchIds = [...new Set(rows.filter(r => moving.includes(r.id)).map(r => r.batchId))];
    for (const batchId of batchIds) if (batchId) await refreshCounts(batchId);
    for (const batchId of batchIds) if (batchId) revalidatePath(`/batch/${batchId}`);
    return { approved: moving.length };
  });
}

/**
 * Rejects one set: the shop has looked at it and does not want it in the export.
 *
 * A set still queued or processing cannot be rejected — there is nothing to look at yet, and the
 * tick that owns it would overwrite the verdict when it finishes.
 */
export async function rejectSetAction(id: string): Promise<ActionResult<null>> {
  return action(async () => {
    const row = await loadSet(id);
    if (isUnderway(row.status)) fail("Set ini masih diproses.");
    await db
      .update(sets)
      .set({ status: "rejected", updatedAt: new Date() })
      .where(eq(sets.id, id))
      .catch(e => fail("Gagal menolak set.", e));
    if (row.batchId) {
      await refreshCounts(row.batchId);
      revalidatePath(`/batch/${row.batchId}`);
    }
    return null;
  });
}

/**
 * Sends one set back through the pipeline.
 *
 * The row goes back to `queued` with its error and member previews cleared, the batch is reopened
 * to `processing` (a tick refuses to work on a batch that is already `ready`), and a fresh chain is
 * kicked. The note the shop typed has no column of its own yet, so it is kept on `input.note`,
 * where a later pass over the prompt can pick it up; nothing reads it today. An empty note clears
 * whatever note was stored before, so a second attempt is not silently steered by the first.
 *
 * A set a tick may still be holding is refused, exactly as `rejectSetAction` refuses one: this is a
 * public POST, and the button being disabled in the gallery guarantees nothing. Requeueing a
 * claimed row would either have that tick's write-back undo the requeue, or let a second tick claim
 * the row and render — and bill for — the same set twice. A batch that has moved on to an export is
 * refused too, for the same reason the tick route will not reopen one.
 */
export async function regenerateSetAction(id: string, note?: string): Promise<ActionResult<null>> {
  return action(async () => {
    const row = await loadSet(id);
    if (isUnderway(row.status)) fail("Set ini masih diproses.");

    const batch = row.batchId
      ? await db.query.batches.findFirst({ where: eq(batches.id, row.batchId) }).catch(e => fail("Gagal membaca batch.", e))
      : undefined;
    if (batch && (batch.status === "exporting" || batch.status === "exported")) {
      fail("Batch ini sudah diekspor. Buat batch baru kalau mau menggambar ulang.");
    }

    const trimmed = note?.trim() ?? "";
    // Rebuilt rather than patched: leaving the key out is how an empty note erases the previous one.
    const input: typeof row.input & { note?: string } = { ...row.input };
    delete input.note;
    if (trimmed !== "") input.note = trimmed;
    await db
      .update(sets)
      .set({
        status: "queued",
        error: null,
        memberStates: initialStates(row.input.members.map(m => m.id)),
        input,
        updatedAt: new Date(),
      })
      .where(eq(sets.id, id))
      .catch(e => fail("Gagal menjadwalkan ulang set ini.", e));

    if (row.batchId) {
      // Reopened first, so the `refreshCounts` below — which closes a batch with nothing left to do
      // — sees the set that was just queued and leaves the batch open for the tick.
      await db.update(batches).set({ status: "processing", updatedAt: new Date() }).where(eq(batches.id, row.batchId));
      await refreshCounts(row.batchId);
      kickTick(await requestOrigin(), row.batchId);
      revalidatePath(`/batch/${row.batchId}`);
    }
    return null;
  });
}

/**
 * Restarts a chain that stopped — a tick that was cut off mid-flight, or a kick that never left.
 *
 * Stranded sets are rescued before anything else: rows a dead tick left in `processing` are put
 * back to `queued`, because a fresh chain claims `queued` rows only and would step straight over
 * them, leaving the batch wedged short of `ready` for good. The answer says both how many were
 * rescued and how many are waiting in total, so the button can report what it actually did.
 */
export async function resumeBatchAction(id: string): Promise<ActionResult<{ remaining: number; requeued: number }>> {
  return action(async () => {
    const batch = await db.query.batches.findFirst({ where: eq(batches.id, id) }).catch(e => fail("Gagal membaca batch.", e));
    if (!batch) fail("Batch ini tidak ada.");

    const rescued = await db
      .update(sets)
      .set({ status: "queued", updatedAt: new Date() })
      .where(strandedSets(id, STALE_CLAIM_MINUTES))
      .returning({ id: sets.id })
      .catch(e => fail("Gagal melanjutkan batch.", e));

    const [waiting] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(sets)
      .where(and(eq(sets.batchId, id), inArray(sets.status, ["queued", "processing"])));
    const remaining = waiting?.n ?? 0;

    if (remaining > 0 && batch.status !== "processing") {
      await db.update(batches).set({ status: "processing", updatedAt: new Date() }).where(eq(batches.id, id));
    }
    // Nothing left to do: this is the wedged batch the button exists for — a tick died before its
    // own roll-up and left the batch open with no work in it. Close it here rather than leave it
    // open forever; `refreshCounts` re-reads the counts and applies the same verdict.
    if (remaining === 0) await refreshCounts(id);
    if (remaining > 0) kickTick(await requestOrigin(), id);
    revalidatePath(`/batch/${id}`);
    return { remaining, requeued: rescued.length };
  });
}

/**
 * Starts the ZIP export of everything the shop approved.
 *
 * The work itself is a separate route, not this action: two hundred sets is minutes of rendering
 * and a Server Action's answer is a response the browser is waiting on. So the batch is flipped to
 * `exporting`, the route is kicked, and the gallery polls until a `zipUrl` appears — the same shape
 * the processing chain already uses.
 *
 * The flip is the lock. It is written with the previous status in the `where`, so a second click,
 * a double-submitted form or a retried kick finds nothing to update and starts no second render of
 * the same two hundred sets. A batch still `processing` is refused outright: the tick only works on
 * a `processing` batch, and taking that status away mid-chain would strand its queued sets.
 */
export async function exportBatchAction(id: string): Promise<ActionResult<{ started: boolean }>> {
  return action(async () => {
    const batch = await db.query.batches.findFirst({ where: eq(batches.id, id) }).catch(e => fail("Gagal membaca batch.", e));
    if (!batch) fail("Batch ini tidak ada.");
    if (batch.status === "processing") fail("Batch masih diproses, tunggu sampai selesai.");
    // An export that was killed mid-stream never gets to write its own verdict, so `exporting` is
    // the one status that can outlive the function holding it. Past twice the route's budget there
    // is no such function left, and the button has to work again or the batch is stuck for good.
    if (batch.status === "exporting" && Date.now() - batch.updatedAt.getTime() < TICK_MAX_SECONDS * 2000) {
      return { started: false };
    }

    const [approved] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(sets)
      .where(and(eq(sets.batchId, id), eq(sets.status, "approved")))
      .catch(e => fail("Gagal membaca set batch ini.", e));
    if ((approved?.n ?? 0) === 0) fail("Setujui minimal satu set dulu sebelum mengunduh ZIP.");

    const claimed = await db
      .update(batches)
      // The previous `zipUrl` is deliberately left in place until the route writes the new one. An
      // export that dies — a lost kick, a killed function — would otherwise leave the shop with
      // nothing downloadable at all after two hours of rendering. The gallery is what keeps the old
      // file from being mistaken for the new one: it hides the download link while the export can
      // still be running, and shows it again only once that export is stale.
      .set({ status: "exporting", error: null, updatedAt: new Date() })
      .where(and(eq(batches.id, id), eq(batches.status, batch.status)))
      .returning({ id: batches.id })
      .catch(e => fail("Gagal memulai ekspor.", e));
    if (claimed.length === 0) return { started: false };

    kick(await requestOrigin(), id, "export");
    revalidatePath(`/batch/${id}`);
    return { started: true };
  });
}
