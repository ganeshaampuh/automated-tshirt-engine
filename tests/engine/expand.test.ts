import { describe, it, expect } from "vitest";
import { expand, applyOverrides } from "@/engine/expand";
import { createNodeMeasurer } from "@/engine/measure";
import { unicornSet, CLIPART_SIZE } from "../fixtures/set-unicorn";

const ctx = { measure: createNodeMeasurer(), clipart: CLIPART_SIZE };

describe("expand", () => {
  it("one design per member, in member order", () => {
    const out = expand(unicornSet(), ctx);
    expect(out.map(o => o.memberId)).toEqual(["ayah", "kid", "kenzi", "mama"]);
    expect(out[0].design.sizeClass).toBe("adult");
    expect(out[1].design.sizeClass).toBe("kids-1-9");
  });

  it("applies per-member overrides by layer id", () => {
    const s = unicornSet();
    s.input.members[0].overrides = { clipart: { x: 123 }, bottom: { color: "#000000" } };
    const d = expand(s, ctx)[0].design;
    expect(d.layers.find(l => l.id === "clipart")).toMatchObject({ x: 123 });
    expect(d.layers.find(l => l.id === "bottom")).toMatchObject({ color: "#000000" });
  });

  it("ignores overrides for unknown layer ids", () => {
    const d = expand(unicornSet(), ctx)[0].design;
    expect(applyOverrides(d, { nope: { x: 1 } })).toEqual(d);
  });

  it("throws when an override produces an invalid layer", () => {
    const d = expand(unicornSet(), ctx)[0].design;
    expect(() => applyOverrides(d, { clipart: { w: -1 } })).toThrow();
    expect(() => applyOverrides(d, { bottom: { color: "red" } })).toThrow();
  });
});
