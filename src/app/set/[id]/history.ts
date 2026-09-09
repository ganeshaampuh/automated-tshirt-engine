"use client";

import type { Action, EditorState } from "./useSetEditor";

/**
 * Undo/redo for the editor. Every edit already flows through one pure reducer, so the history is a
 * reducer wrapped around that one: `past` and `future` hold whole `EditorState` snapshots, and an
 * undo is a shuffle between the three slots. `key` and `at` remember what the last recorded edit
 * touched and when, which is what lets a burst of keystrokes collapse into a single undo step.
 */
export type History<S> = {
  past: S[];
  present: S;
  future: S[];
  key: string | null;
  at: number;
};

export type HistoryAction = { type: "undo" } | { type: "redo" };

/** Snapshots kept behind the present. Deep enough to cover a work session, shallow enough to hold. */
export const HISTORY_LIMIT = 50;

/** Two edits of the same thing closer together than this are one step. Roughly a typing pause. */
export const MERGE_MS = 600;

/** Which member's tab is open is where the user is looking, not an edit — undo must not move it. */
function isTransient(action: Action): boolean {
  return action.type === "setMember";
}

/**
 * Names the edit an action performs, so a following action with the same name (and inside
 * `MERGE_MS`) continues it instead of starting a new undo step. `null` means "never merge": a
 * structural change is always worth its own step.
 *
 * The name is fine-grained on purpose — it includes the member, the layer and the exact fields being
 * written, so dragging one layer then another, or typing a name then a theme, stay separate. Bursts
 * are handled by the time window rather than by lumping edits together.
 */
export function mergeKey(action: Action): string | null {
  const fields = (patch: object) => Object.keys(patch).sort().join(",");
  switch (action.type) {
    case "setInput":
      return `setInput:${fields(action.patch)}`;
    case "setStyle":
      return `setStyle:${fields(action.patch)}`;
    case "updateMember":
      return `updateMember:${action.id}:${fields(action.patch)}`;
    case "patchLayer":
      return `patchLayer:${action.scope}:${action.memberId}:${action.layerId}:${fields(action.patch)}`;
    default:
      return null;
  }
}

export function initialHistory<S>(present: S): History<S> {
  return { past: [], present, future: [], key: null, at: 0 };
}

/** Lifts the editor reducer into one that also keeps the undo stacks. `now` is injected for tests. */
export function withHistory(
  reducer: (state: EditorState, action: Action) => EditorState,
  { now = Date.now }: { now?: () => number } = {},
) {
  return function historyReducer(state: History<EditorState>, action: Action | HistoryAction): History<EditorState> {
    if (action.type === "undo") {
      if (!state.past.length) return state;
      return {
        past: state.past.slice(0, -1),
        present: state.past[state.past.length - 1],
        future: [state.present, ...state.future],
        key: null,
        at: 0,
      };
    }

    if (action.type === "redo") {
      if (!state.future.length) return state;
      return {
        past: [...state.past, state.present],
        present: state.future[0],
        future: state.future.slice(1),
        key: null,
        at: 0,
      };
    }

    const present = reducer(state.present, action);
    // A refused action (removing the birthday kid, say) returns the same state and earns no step.
    if (present === state.present) return state;
    if (isTransient(action)) return { ...state, present, key: null, at: 0 };

    const key = mergeKey(action);
    const at = now();
    if (key !== null && key === state.key && at - state.at < MERGE_MS) {
      return { ...state, present, future: [], at };
    }
    return { past: [...state.past, state.present].slice(-HISTORY_LIMIT), present, future: [], key, at };
  };
}
