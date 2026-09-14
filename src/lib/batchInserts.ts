import type { ParsedRow } from "@/lib/csv";
import { initialStates } from "@/lib/memberState";
import type { MemberStates } from "@/lib/memberState";
import type { SetInput, SetStyle } from "@/engine";
import type { SetStatus } from "@/lib/memberState";

export type SetInsert = { batchId: string; status: SetStatus; input: SetInput; memberStates: MemberStates };

/**
 * The rows of a validated CSV turned into `sets` insert payloads: every set starts `queued`, and so
 * does every one of its members, in the row's own member order.
 *
 * It lives here rather than beside the action because a `"use server"` module may export only async
 * functions, and because importing that module would open a database connection — this mapping is
 * the part worth pinning in a test, and it must be testable without one.
 */
export function rowsToInserts(batchId: string, rows: ParsedRow[]): SetInsert[] {
  return rows.map(row => ({
    batchId,
    status: "queued",
    input: row.input,
    memberStates: initialStates(row.input.members.map(m => m.id)),
  }));
}

/** The suffix that tells a copy apart from the set it came from. */
export const COPY_SUFFIX = " (salinan)";

/** `SetInputSchema` caps `name`, so the base is trimmed to leave the suffix room inside the limit. */
const MAX_NAME = 80;

/**
 * What a copy is called: the set's own label, or the child's name when it has none, plus the suffix.
 *
 * A name is written even when the original had none, because two cards showing the same child are
 * otherwise indistinguishable in the gallery — and `setTitle` keeps the child's name as the
 * subtitle, so nothing is hidden by naming the copy. Copying a copy appends again rather than
 * detecting the suffix: "Rina (salinan) (salinan)" is ugly but it is still two different rows, while
 * reusing the same name would put the shop back where it started.
 */
function copyName(input: SetInput): string {
  const base = (input.name?.trim() || input.kidName).trim();
  const room = MAX_NAME - COPY_SUFFIX.length;
  return `${base.length > room ? base.slice(0, room).trimEnd() : base}${COPY_SUFFIX}`;
}

/** The columns a duplicate is built from — a whole `SetRow` satisfies it. */
export type DuplicateSource = { batchId: string | null; input: SetInput; style?: SetStyle | null };

/**
 * One set turned into an insert payload for a copy of itself.
 *
 * A copy inside a batch starts `queued`, with every member queued, so the pipeline draws it its own
 * artwork: sharing the original's previews would give two rows one set of files, and deleting either
 * would break the other. A copy of a bench set — one with no batch — has no tick to draw it and
 * stays a `draft`, exactly where `createSet` leaves a new one.
 *
 * The clipart is the one file the copy does share, and it is pinned onto `input.clipartSrc` rather
 * than left on the style alone. That is what makes the sharing safe as well as free: `orphanBlobs`
 * deletes a tick's clipart only when the tick minted it, and a row that arrives carrying its own
 * `clipartSrc` reads as a file the shop supplied — so a copy deleted mid-render cannot take the
 * original's clipart with it.
 *
 * Lives here, beside `rowsToInserts`, for the same two reasons: a `"use server"` module may export
 * only async functions, and this mapping is the part worth pinning without a database.
 */
export function duplicateInsert(row: DuplicateSource): {
  batchId: string | null;
  status: SetStatus;
  input: SetInput;
  style: SetStyle | null;
  memberStates: MemberStates | null;
} {
  const clipartSrc = row.input.clipartSrc ?? row.style?.clipartSrc;
  const input: SetInput = { ...row.input, name: copyName(row.input), ...(clipartSrc ? { clipartSrc } : {}) };
  return {
    batchId: row.batchId,
    status: row.batchId ? "queued" : "draft",
    input,
    style: row.style ?? null,
    memberStates: row.batchId ? initialStates(input.members.map(m => m.id)) : null,
  };
}
