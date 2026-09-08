import { describe, it, expect } from "vitest";
import { reducer, starterStyle, type Action, type EditorState } from "@/app/set/[id]/useSetEditor";
import { unicornSet } from "../fixtures/set-unicorn";

function initial(): EditorState {
  const set = unicornSet("id");
  return { id: "set-1", input: set.input, style: set.style, memberId: "ayah" };
}

const run = (state: EditorState, ...actions: Action[]) => actions.reduce(reducer, state);
const member = (s: EditorState, id: string) => s.input.members.find(m => m.id === id)!;

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
