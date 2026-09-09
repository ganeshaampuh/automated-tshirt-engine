import { describe, it, expect } from "vitest";
import { HISTORY_LIMIT, MERGE_MS, mergeKey, withHistory, type History } from "@/app/set/[id]/history";
import { reducer, type Action, type EditorState } from "@/app/set/[id]/useSetEditor";
import { unicornSet } from "../fixtures/set-unicorn";

/** A hand-cranked clock, so the merge window is tested without waiting for it. */
function clock() {
  let t = 1000;
  return { now: () => t, tick: (ms: number) => (t += ms) };
}

function start(): History<EditorState> {
  const set = unicornSet("id");
  return {
    past: [],
    present: { id: "set-1", input: set.input, style: set.style, memberId: "ayah" },
    future: [],
    key: null,
    at: 0,
  };
}

const name = (h: History<EditorState>) => h.present.input.kidName;
const setName = (kidName: string): Action => ({ type: "setInput", patch: { kidName } });

describe("withHistory", () => {
  it("undoes and redoes an edit", () => {
    const c = clock();
    const history = withHistory(reducer, { now: c.now });
    let h = start();
    const before = name(h);

    h = history(h, setName("Nadia"));
    expect(name(h)).toBe("Nadia");

    h = history(h, { type: "undo" });
    expect(name(h)).toBe(before);

    h = history(h, { type: "redo" });
    expect(name(h)).toBe("Nadia");
  });

  it("does nothing when there is nothing to undo or redo", () => {
    const history = withHistory(reducer, { now: clock().now });
    const h = start();
    expect(history(h, { type: "undo" })).toBe(h);
    expect(history(h, { type: "redo" })).toBe(h);
  });

  it("drops the redo stack once a new edit lands", () => {
    const c = clock();
    const history = withHistory(reducer, { now: c.now });
    let h = history(start(), setName("Nadia"));
    h = history(h, { type: "undo" });
    c.tick(MERGE_MS * 2);
    h = history(h, setName("Rara"));
    expect(h.future).toHaveLength(0);
    expect(history(h, { type: "redo" })).toBe(h);
  });

  it("merges edits of the same field inside the window into one undo step", () => {
    const c = clock();
    const history = withHistory(reducer, { now: c.now });
    let h = start();
    const before = name(h);

    for (const step of ["N", "Na", "Nad"]) {
      h = history(h, setName(step));
      c.tick(MERGE_MS / 4);
    }
    expect(name(h)).toBe("Nad");
    expect(h.past).toHaveLength(1);

    h = history(h, { type: "undo" });
    expect(name(h)).toBe(before);
  });

  it("starts a new undo step once the window has passed", () => {
    const c = clock();
    const history = withHistory(reducer, { now: c.now });
    let h = history(start(), setName("Nadia"));
    c.tick(MERGE_MS + 1);
    h = history(h, setName("Nadia Putri"));

    expect(h.past).toHaveLength(2);
    h = history(h, { type: "undo" });
    expect(name(h)).toBe("Nadia");
  });

  it("starts a new undo step when the edit moves to another field", () => {
    const c = clock();
    const history = withHistory(reducer, { now: c.now });
    let h = history(start(), setName("Nadia"));
    h = history(h, { type: "setInput", patch: { theme: "unicorn pastel" } });

    expect(h.past).toHaveLength(2);
    h = history(h, { type: "undo" });
    expect(name(h)).toBe("Nadia");
  });

  it("keeps drags of different layers as separate undo steps", () => {
    const c = clock();
    const history = withHistory(reducer, { now: c.now });
    let h = start();
    h = history(h, { type: "patchLayer", memberId: "kid", layerId: "top", patch: { x: 5 }, scope: "member" });
    h = history(h, { type: "patchLayer", memberId: "kid", layerId: "numeral", patch: { x: 7 }, scope: "member" });
    expect(h.past).toHaveLength(2);
  });

  it("does not record a member tab switch, and never merges across one", () => {
    const c = clock();
    const history = withHistory(reducer, { now: c.now });
    let h = history(start(), setName("Nadia"));
    h = history(h, { type: "setMember", id: "kenzi" });
    expect(h.past).toHaveLength(1);
    expect(h.present.memberId).toBe("kenzi");

    h = history(h, setName("Nadia P"));
    expect(h.past).toHaveLength(2);

    // Undo restores the edit only — the tab the user is looking at stays put.
    h = history(h, { type: "undo" });
    expect(name(h)).toBe("Nadia");
    expect(h.present.memberId).toBe("kenzi");
  });

  it("leaves the stacks alone when an action changes nothing", () => {
    const history = withHistory(reducer, { now: clock().now });
    const h = start();
    // The birthday kid can never be removed, so the reducer returns the same state.
    expect(history(h, { type: "removeMember", id: "kid" })).toBe(h);
  });

  it("forgets the oldest steps past the limit", () => {
    const c = clock();
    const history = withHistory(reducer, { now: c.now });
    let h = start();
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) {
      h = history(h, setName(`Nama ${i}`));
      c.tick(MERGE_MS + 1);
    }
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    // The oldest surviving step is the tenth edit's predecessor, not the original name.
    expect(h.past[0].input.kidName).toBe("Nama 9");
  });
});

describe("mergeKey", () => {
  it("groups edits to the same field of the same layer", () => {
    const a: Action = { type: "patchLayer", memberId: "kid", layerId: "top", patch: { x: 1 }, scope: "member" };
    const b: Action = { type: "patchLayer", memberId: "kid", layerId: "top", patch: { x: 2 }, scope: "member" };
    expect(mergeKey(a)).toBe(mergeKey(b));
  });

  it("separates different layers, members, scopes and fields", () => {
    const base = { type: "patchLayer", memberId: "kid", layerId: "top", patch: { x: 1 }, scope: "member" } as const;
    const keys = new Set([
      mergeKey(base),
      mergeKey({ ...base, layerId: "numeral" }),
      mergeKey({ ...base, memberId: "ayah" }),
      mergeKey({ ...base, scope: "set" }),
      mergeKey({ ...base, patch: { y: 1 } }),
    ]);
    expect(keys.size).toBe(5);
  });

  it("never merges a structural change", () => {
    expect(mergeKey({ type: "removeMember", id: "kenzi" })).toBeNull();
    expect(mergeKey({ type: "resetOverride", memberId: "kid", layerId: "top" })).toBeNull();
    expect(mergeKey({ type: "loaded", style: unicornSet("id").style! })).toBeNull();
  });
});
