import { describe, it, expect } from "vitest";
import { DEFAULT_SCOPE, reducer, safetyWarning, starterStyle, unsafeMemberIds, type Action, type EditorState } from "@/app/set/[id]/useSetEditor";
import { canvasFor, type Design } from "@/engine";
import { unicornSet } from "../fixtures/set-unicorn";

function initial(): EditorState {
  const set = unicornSet("id");
  return { id: "set-1", input: set.input, style: set.style, memberId: "ayah" };
}

const run = (state: EditorState, ...actions: Action[]) => actions.reduce(reducer, state);
const member = (s: EditorState, id: string) => s.input.members.find(m => m.id === id)!;

/**
 * The scope toggle's opening position, which decides where an edit lands for a shop that never
 * touches it. It starts on the one shirt: a nudge meant for one member that quietly moved four is
 * work to undo, while a set-wide change the shop has to ask for by sliding the toggle is one click.
 * The cheap mistake is the one worth defaulting to.
 */
describe("DEFAULT_SCOPE", () => {
  it("edits the open shirt, not the whole set", () => expect(DEFAULT_SCOPE).toBe("member"));
});

describe("useSetEditor reducer", () => {
  it("spreads a geometry patch over every member when the scope is the set", () => {
    const next = run(initial(), { type: "patchLayer", memberId: "ayah", layerId: "numeral", patch: { x: 10 }, scope: "set" });
    for (const m of next.input.members) expect(m.overrides?.numeral).toEqual({ x: 10 });
  });

  it("keeps a member-scoped patch on that member alone", () => {
    const next = run(initial(), { type: "patchLayer", memberId: "mama", layerId: "clipart", patch: { x: 5, y: 6 }, scope: "member" });
    expect(member(next, "mama").overrides?.clipart).toEqual({ x: 5, y: 6 });
    expect(member(next, "ayah").overrides).toBeUndefined();
  });

  it("merges repeated patches for the same layer", () => {
    const next = run(
      initial(),
      { type: "patchLayer", memberId: "mama", layerId: "clipart", patch: { x: 5 }, scope: "member" },
      { type: "patchLayer", memberId: "mama", layerId: "clipart", patch: { y: 8 }, scope: "member" },
    );
    expect(member(next, "mama").overrides?.clipart).toEqual({ x: 5, y: 8 });
  });

  it("writes a set-scoped font to the style, not to overrides", () => {
    const next = run(initial(), { type: "patchLayer", memberId: "ayah", layerId: "top", patch: { font: "Bangers" }, scope: "set" });
    expect(next.style?.font).toBe("Bangers");
    expect(member(next, "ayah").overrides).toBeUndefined();
  });

  it("writes a set-scoped colour to the palette: primary normally, secondary for the numeral", () => {
    const base = initial();
    const primary = run(base, { type: "patchLayer", memberId: "ayah", layerId: "bottom", patch: { color: "#123456" }, scope: "set" });
    expect(primary.style?.palette.primary).toBe("#123456");
    expect(primary.style?.palette.secondary).toBe(base.style?.palette.secondary);

    const secondary = run(base, { type: "patchLayer", memberId: "ayah", layerId: "numeral", patch: { color: "#654321" }, scope: "set" });
    expect(secondary.style?.palette.secondary).toBe("#654321");
    expect(secondary.style?.palette.primary).toBe(base.style?.palette.primary);
  });

  it("writes a set-scoped numeral stroke to the outline colour and keeps its width as an override", () => {
    const next = run(initial(), {
      type: "patchLayer", memberId: "ayah", layerId: "numeral", patch: { stroke: { color: "#000000", width: 4 } }, scope: "set",
    });
    expect(next.style?.palette.outline).toBe("#000000");
    for (const m of next.input.members) expect(m.overrides?.numeral).toEqual({ stroke: { color: "#000000", width: 4 } });
  });

  it("keeps a member-scoped font or colour as an override on that member", () => {
    const next = run(initial(), { type: "patchLayer", memberId: "kid", layerId: "top", patch: { font: "Chewy", color: "#00ff00" }, scope: "member" });
    expect(member(next, "kid").overrides?.top).toEqual({ font: "Chewy", color: "#00ff00" });
    expect(next.style?.font).toBe(initial().style?.font);
  });

  it("removes just the reset layer's override", () => {
    const next = run(
      initial(),
      { type: "patchLayer", memberId: "kid", layerId: "top", patch: { x: 1 }, scope: "member" },
      { type: "patchLayer", memberId: "kid", layerId: "bottom", patch: { y: 2 }, scope: "member" },
      { type: "resetOverride", memberId: "kid", layerId: "top" },
    );
    expect(member(next, "kid").overrides).toEqual({ bottom: { y: 2 } });
  });

  it("drops the overrides key entirely once the last override is reset", () => {
    const next = run(
      initial(),
      { type: "patchLayer", memberId: "kid", layerId: "top", patch: { x: 1 }, scope: "member" },
      { type: "resetOverride", memberId: "kid", layerId: "top" },
    );
    expect(member(next, "kid").overrides).toBeUndefined();
  });

  it("moves a layer one step forward, and to the front, for the whole set", () => {
    const ids = ["numeral", "clipart", "top", "ordinal", "occasion", "bottom"];
    const forward = run(initial(), { type: "reorderLayer", memberId: "kid", layerId: "numeral", move: "forward", ids, scope: "set" });
    for (const m of forward.input.members) {
      expect(m.order).toEqual(["clipart", "numeral", "top", "ordinal", "occasion", "bottom"]);
    }

    const front = run(initial(), { type: "reorderLayer", memberId: "kid", layerId: "numeral", move: "front", ids, scope: "set" });
    expect(front.input.members[0].order).toEqual(["clipart", "top", "ordinal", "occasion", "bottom", "numeral"]);
  });

  it("moves a layer backward, and to the back, on that member alone", () => {
    const ids = ["numeral", "clipart", "top", "ordinal", "occasion", "bottom"];
    const backward = run(initial(), { type: "reorderLayer", memberId: "kid", layerId: "bottom", move: "backward", ids, scope: "member" });
    expect(member(backward, "kid").order).toEqual(["numeral", "clipart", "top", "ordinal", "bottom", "occasion"]);
    expect(member(backward, "ayah").order).toBeUndefined();

    const back = run(initial(), { type: "reorderLayer", memberId: "kid", layerId: "bottom", move: "back", ids, scope: "member" });
    expect(member(back, "kid").order).toEqual(["bottom", "numeral", "clipart", "top", "ordinal", "occasion"]);
  });

  it("reorders from the member's own stack once it has one", () => {
    const ids = ["numeral", "clipart", "top", "ordinal", "occasion", "bottom"];
    const next = run(
      initial(),
      { type: "reorderLayer", memberId: "kid", layerId: "numeral", move: "front", ids, scope: "member" },
      // The canvas now reports the reordered stack, and a second move works from that.
      { type: "reorderLayer", memberId: "kid", layerId: "numeral", move: "backward", ids: ["clipart", "top", "ordinal", "occasion", "bottom", "numeral"], scope: "member" },
    );
    expect(member(next, "kid").order).toEqual(["clipart", "top", "ordinal", "occasion", "numeral", "bottom"]);
  });

  it("leaves the state untouched when a layer is already at the end it is moving towards", () => {
    const ids = ["numeral", "clipart", "top", "ordinal", "occasion", "bottom"];
    const base = initial();
    for (const move of ["back", "backward"] as const) {
      expect(run(base, { type: "reorderLayer", memberId: "kid", layerId: "numeral", move, ids, scope: "set" })).toBe(base);
    }
    for (const move of ["front", "forward"] as const) {
      expect(run(base, { type: "reorderLayer", memberId: "kid", layerId: "bottom", move, ids, scope: "set" })).toBe(base);
    }
  });

  it("refuses to remove the birthday kid but removes family members", () => {
    const kept = run(initial(), { type: "removeMember", id: "kid" });
    expect(kept.input.members.map(m => m.id)).toContain("kid");

    const removed = run(initial(), { type: "removeMember", id: "kenzi" });
    expect(removed.input.members.map(m => m.id)).not.toContain("kenzi");
  });

  it("moves the active tab off a removed member", () => {
    const next = run(initial(), { type: "setMember", id: "kenzi" }, { type: "removeMember", id: "kenzi" });
    expect(next.memberId).toBe("ayah");
  });

  it("renames the birthday kid's tab with the kid name, and refreshes default wording", () => {
    const next = run(initial(), { type: "setInput", patch: { kidName: "Nadia" } });
    expect(member(next, "kid").label).toBe("Nadia");
    expect(next.style?.wording.familyTop).toBe("Nadia");
  });

  it("leaves hand-written wording alone when the name changes", () => {
    const next = run(
      initial(),
      { type: "setStyle", patch: { wording: { ...initial().style!.wording, familyTop: "Tim Keisya" } } },
      { type: "setInput", patch: { kidName: "Nadia" } },
    );
    expect(next.style?.wording.familyTop).toBe("Tim Keisya");
  });

  it("leaves a hand-renamed kid tab alone", () => {
    const next = run(
      initial(),
      { type: "updateMember", id: "kid", patch: { label: "Si Kecil" } },
      { type: "setInput", patch: { kidName: "Nadia" } },
    );
    expect(member(next, "kid").label).toBe("Si Kecil");
  });

  it("carries a new clipart into the style", () => {
    const next = run(initial(), { type: "setInput", patch: { clipartSrc: "/samples/robot.png" } });
    expect(next.style?.clipartSrc).toBe("/samples/robot.png");
  });

  it("adds a member and makes it the active tab", () => {
    const next = run(initial(), { type: "addMember", member: { id: "adik", kind: "family", label: "Adik", sizeClass: "kids-1-9" } });
    expect(next.memberId).toBe("adik");
    expect(next.input.members).toHaveLength(5);
  });

  it("starterStyle needs a clipart", () => {
    const input = initial().input;
    expect(starterStyle({ ...input, clipartSrc: undefined })).toBeNull();
    expect(starterStyle({ ...input, clipartSrc: "/samples/unicorn.png" })?.clipartSrc).toBe("/samples/unicorn.png");
  });
});

/** A one-layer design whose image sits inside or outside the 3% safe inset. */
function design(inset: number): Design {
  const canvas = canvasFor("adult");
  return {
    version: 2,
    sizeClass: "adult",
    canvas,
    shirtColor: "#ffffff",
    layers: [{ id: "clipart", type: "image", src: "x.png", x: inset, y: inset, w: 100, h: 100 }],
  };
}

describe("safe-area reporting", () => {
  const members = unicornSet("id").input.members;
  const designs = new Map<string, Design>([
    ["ayah", design(0)], // starts on the canvas edge, outside the safe inset
    ["kid", design(500)],
    ["kenzi", design(0)],
    ["mama", design(500)],
  ]);

  it("lists every member whose design leaves the safe area", () => {
    expect(unsafeMemberIds(designs)).toEqual(["ayah", "kenzi"]);
  });

  it("reports nothing without designs", () => {
    expect(unsafeMemberIds(null)).toEqual([]);
    expect(safetyWarning(members, [])).toBeNull();
  });

  it("names one offending member", () => {
    expect(safetyWarning(members, ["mama"])).toBe("Desain Mama keluar dari area aman");
  });

  it("names several, so a warning off the open tab still reads", () => {
    expect(safetyWarning(members, ["ayah", "kid", "kenzi"])).toBe("Desain Ayah, Keisya dan Kenzi keluar dari area aman");
  });

  it("falls back to a placeholder for a member with no label", () => {
    expect(safetyWarning([{ ...members[0], label: " " }], ["ayah"])).toBe("Desain tanpa nama keluar dari area aman");
  });
});

describe("deleting and restoring a layer", () => {
  it("records the delete as a member-scoped override", () => {
    const next = run(initial(), { type: "patchLayer", memberId: "mama", layerId: "top", patch: { hidden: true }, scope: "member" });
    expect(member(next, "mama").overrides?.top).toEqual({ hidden: true });
    expect(member(next, "ayah").overrides).toBeUndefined();
  });

  it("deletes the layer from every shirt when the scope is the set", () => {
    const next = run(initial(), { type: "patchLayer", memberId: "ayah", layerId: "top", patch: { hidden: true }, scope: "set" });
    for (const m of next.input.members) expect(m.overrides?.top).toEqual({ hidden: true });
  });

  it("restores the layer without disturbing the tweaks it already carried", () => {
    const next = run(
      initial(),
      { type: "patchLayer", memberId: "mama", layerId: "bottom", patch: { x: 40 }, scope: "member" },
      { type: "patchLayer", memberId: "mama", layerId: "bottom", patch: { hidden: true }, scope: "member" },
      { type: "patchLayer", memberId: "mama", layerId: "bottom", patch: { hidden: false }, scope: "member" },
    );
    expect(member(next, "mama").overrides?.bottom).toEqual({ x: 40, hidden: false });
  });

  it("leaves the shared style alone — a delete is never a palette change", () => {
    const before = initial();
    const next = run(before, { type: "patchLayer", memberId: "ayah", layerId: "numeral", patch: { hidden: true }, scope: "set" });
    expect(next.style).toEqual(before.style);
  });
});
