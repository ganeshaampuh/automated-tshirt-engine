/**
 * The gallery's arithmetic, kept pure so both the page and the actions read the same rules and the
 * test can pin them without a database. `src/app/actions/batches.ts` is a `"use server"` module and
 * may only export async functions, which is why these live here rather than beside the actions.
 */

/** Only the column each rule reads, so a whole `SetRow` satisfies it and a test can write one line. */
export type StatusRow = { id: string; status: string };

export type GalleryCounts = {
  total: number;
  queued: number;
  processing: number;
  ready: number;
  approved: number;
  rejected: number;
  failed: number;
};

const ZERO: Omit<GalleryCounts, "total"> = { queued: 0, processing: 0, ready: 0, approved: 0, rejected: 0, failed: 0 };

export function galleryCounts(rows: { status: string }[]): GalleryCounts {
  const counts: GalleryCounts = { total: rows.length, ...ZERO };
  for (const row of rows) {
    // An unknown status (a stray `draft`) still counts towards the total but claims no bucket.
    if (row.status in ZERO) counts[row.status as keyof typeof ZERO] += 1;
  }
  return counts;
}

/** Whether work is still moving — what the page polls on. */
export const isBusy = (c: GalleryCounts) => c.queued + c.processing > 0;

/** Whether a tick may still be holding this set. Such a row is nobody else's to rewrite. */
export const isUnderway = (status: string) => status === "queued" || status === "processing";

/**
 * Whether to offer "Lanjutkan".
 *
 * Not simply `isBusy`: a tick that died between its per-set writes and its roll-up leaves every set
 * settled while the batch row still says `processing`, and that batch can only be closed by a
 * resume. Offering the button whenever the batch is open keeps that state reachable instead of
 * stranding it.
 */
export const resumeOffered = (c: GalleryCounts, batchStatus: string) => isBusy(c) || batchStatus === "processing";

/**
 * How long a batch may sit at `exporting` before the gallery treats that export as dead.
 *
 * An export that is killed mid-stream never writes its own verdict, so `exporting` is the one
 * status that can outlive the function holding it — and the batch would then have no button on the
 * page able to move it, because the export button is disabled exactly while `exporting`. Ten
 * minutes is twice the export route's own budget: past that there is no function left that could
 * still be writing the ZIP.
 *
 * Written as a literal rather than imported from `@/lib/processSet`, which pulls in the node-only
 * render stack and cannot be in the client bundle this module is part of. `tests/app/gallery.test.ts`
 * fails if it ever drifts from `TICK_MAX_SECONDS * 2000`, the same threshold `exportBatchAction`
 * enforces server-side.
 */
export const EXPORT_STALE_MS = 600_000;

/**
 * Whether the export may be started again.
 *
 * The server-side rule is in `exportBatchAction`, which refuses a second export while `exporting`
 * is younger than this. Without the same rule here the recovery it offers is unreachable: the only
 * button that calls the action is disabled while the batch says `exporting`, so a lost kick — a
 * transient 500, a cold start, an empty origin — wedges the batch for good.
 */
export const exportRetryable = (batchStatus: string, updatedAt: number, now: number) =>
  batchStatus === "exporting" && now - updatedAt > EXPORT_STALE_MS;

/**
 * The status bar's sentence, spec §8.2: "12 dari 20 set siap · 3 disetujui · 1 gagal".
 *
 * "Siap" is a set whose artwork came out, so an approved or a rejected one still counts — the shop
 * judged it, it did not stop existing. A failed set is not siap; it is reported separately as
 * "gagal", which is why the sample sentence's 12 and 1 do not add up to its 20.
 */
export function progressLine(c: GalleryCounts): string {
  const settled = c.ready + c.approved + c.rejected;
  const parts = [`${settled} dari ${c.total} set siap`];
  if (c.approved > 0) parts.push(`${c.approved} disetujui`);
  if (c.rejected > 0) parts.push(`${c.rejected} ditolak`);
  if (c.failed > 0) parts.push(`${c.failed} gagal`);
  return parts.join(" · ");
}

/**
 * How full the progress bar is, 0–1: everything that is no longer waiting, a failed set included —
 * the bar tracks the machine's work, not the shop's verdict. An empty batch reads empty, not NaN.
 */
export const progressFraction = (c: GalleryCounts) => (c.total === 0 ? 0 : (c.total - c.queued - c.processing) / c.total);

/**
 * Which of the ids asked for may actually be approved: the ones that are `ready` among `rows`.
 *
 * A stale checkbox — the set failed, or another tab approved it since the page loaded — is dropped
 * rather than advanced, so "Setujui terpilih" can never approve a failed set or count an already
 * approved one twice.
 *
 * This is a status rule, not a scoping one: an id is dropped when it is absent from `rows`, and the
 * caller decides what `rows` holds. `approveSetsAction` reads the rows by id alone, so it will
 * approve a `ready` set from another batch if one is named. The app has no accounts and every batch
 * belongs to the same shop, so that is the existing posture rather than a hole opened here.
 */
export function approvable(ids: string[], rows: StatusRow[]): string[] {
  const ready = new Set(rows.filter(r => r.status === "ready").map(r => r.id));
  return [...new Set(ids)].filter(id => ready.has(id));
}

/**
 * A fingerprint of everything the gallery can see moving.
 *
 * The poll compares it between refreshes to answer one question: did anything actually change? A
 * batch wedged by a tick that died still reports work `queued` or `processing` and would otherwise
 * be polled forever, so the page stops once this has held still and offers the resume instead.
 * Member states are included because a set can be visibly filling in while its own status does not
 * move.
 */
export function statusSignature(rows: { id: string; status: string; memberStates?: unknown }[]): string {
  return rows.map(r => `${r.id}:${r.status}:${JSON.stringify(r.memberStates ?? null)}`).join("|");
}

/**
 * Which of the ids asked for may actually be deleted: everything among `rows` that no tick is
 * holding.
 *
 * Wider than `approvable` on purpose. An approval only ever moves a `ready` set, but the sets a
 * shop most wants gone are the failed and the rejected ones, so every settled status qualifies.
 * `isUnderway` is the whole guard: a `queued` or `processing` row belongs to a tick that will write
 * its result back, and deleting it under that tick leaves the write with no row to land on.
 *
 * Scoped exactly as `approvable` is — an id absent from `rows` is dropped, and the caller decides
 * what `rows` holds. See that function for why the app's no-accounts posture makes this the
 * existing stance rather than a hole opened here.
 */
export function deletable(ids: string[], rows: StatusRow[]): string[] {
  const settled = new Set(rows.filter(r => !isUnderway(r.status)).map(r => r.id));
  return [...new Set(ids)].filter(id => settled.has(id));
}

/**
 * Whether a whole batch may be deleted.
 *
 * The two refusals are the two states with a live function behind them: `processing` has a tick
 * claiming sets, `exporting` has a route streaming a ZIP out of them. Deleting either would leave
 * that function writing to rows that no longer exist — and, worse, a tick that re-opens the batch
 * row it is holding would resurrect a batch the shop believes it deleted.
 *
 * Unlike the export's own stale-window escape, there is no time-based override here: a delete is
 * the one verdict that cannot be walked back, so a batch wedged at `exporting` is cleared with
 * "Lanjutkan" or the export retry first, and deleted afterwards.
 */
export const batchDeletable = (batchStatus: string) => batchStatus !== "processing" && batchStatus !== "exporting";
