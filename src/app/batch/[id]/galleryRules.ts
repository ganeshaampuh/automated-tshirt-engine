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

/** Whether work is still moving — what the page polls on, and what "Lanjutkan" is offered for. */
export const isBusy = (c: GalleryCounts) => c.queued + c.processing > 0;

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
 * Which of the ids asked for may actually be approved: the ones that are `ready` in this batch
 * right now.
 *
 * A stale checkbox — the set failed, or another tab approved it since the page loaded — is dropped
 * rather than advanced, so "Setujui terpilih" can never approve a failed set or count an already
 * approved one twice. Ids from outside the batch are unknown here and dropped with them.
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
