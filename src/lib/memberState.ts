export type MemberStatus = "queued" | "ready" | "failed";
export type MemberState = { status: MemberStatus; previewUrl?: string; widthCm?: number; heightCm?: number; error?: string };
export type MemberStates = Record<string, MemberState>;

export const initialStates = (ids: string[]): MemberStates =>
  Object.fromEntries(ids.map(id => [id, { status: "queued" as const }]));

export function setMemberState(states: MemberStates, id: string, patch: Partial<MemberState>): MemberStates {
  if (!(id in states)) return states;
  return { ...states, [id]: { ...states[id], ...patch } };
}

export function rollUp(states: MemberStates) {
  const all = Object.values(states);
  return {
    total: all.length,
    ready: all.filter(s => s.status === "ready").length,
    failed: all.filter(s => s.status === "failed").length,
    queued: all.filter(s => s.status === "queued").length,
  };
}

export const allReady = (states: MemberStates) =>
  Object.values(states).length > 0 && Object.values(states).every(s => s.status === "ready");

/** A set's status vocabulary. Written today only as "draft"; the rest are reserved for the batch pipeline. */
export const SET_STATUSES = ["draft", "queued", "processing", "ready", "approved", "rejected", "failed"] as const;
export type SetStatus = (typeof SET_STATUSES)[number];

/**
 * A batch's status vocabulary — deliberately distinct from a set's. A batch is `ready` when no set
 * in it is still `queued` or `processing`, whatever mix of `ready`/`failed` those sets landed in.
 */
export const BATCH_STATUSES = ["processing", "ready", "exporting", "exported", "failed"] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];
