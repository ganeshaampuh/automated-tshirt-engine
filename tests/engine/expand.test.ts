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

  it("refuses an override that points a layer at a file on the server", () => {
    const d = expand(unicornSet(), ctx)[0].design;
    for (const src of ["/etc/passwd", "../../etc/passwd", "tests/fixtures/../../etc/passwd", "file:///etc/passwd", "http://169.254.169.254/latest/meta-data"])
      expect(() => applyOverrides(d, { clipart: { src } }), src).toThrow();
    // the shapes the app itself produces still pass
    expect(() => applyOverrides(d, { clipart: { src: "https://blob.example/a.png" } })).not.toThrow();
    expect(() => applyOverrides(d, { clipart: { src: "tests/fixtures/unicorn.png" } })).not.toThrow();
  });

  it("refuses the same override when it arrives through expand, on any member", () => {
    const s = unicornSet();
    s.input.members[2].overrides = { clipart: { src: "/etc/passwd" } };
    expect(() => expand(s, ctx)).toThrow();
  });
});

describe("applyOrder", () => {
  const stack = (s = unicornSet()) => expand(s, ctx)[0].design.layers.map(l => l.id);

  it("leaves the template order alone when a member has no order of its own", () => {
    expect(stack()).toEqual(["numeral", "clipart", "top", "ordinal", "occasion", "bottom"]);
  });

  it("draws the layers in the member's stored order", () => {
    const s = unicornSet();
    const order = ["clipart", "numeral", "top", "ordinal", "occasion", "bottom"];
    s.input.members[0].order = order;
    expect(stack(s)).toEqual(order);
    // …and only for that member.
    expect(expand(s, ctx)[1].design.layers.map(l => l.id)).toEqual(stack());
  });

  it("keeps the overrides working on a reordered stack", () => {
    const s = unicornSet();
    s.input.members[0].order = ["clipart", "numeral", "top", "ordinal", "occasion", "bottom"];
    s.input.members[0].overrides = { clipart: { x: 123 } };
    const d = expand(s, ctx)[0].design;
    expect(d.layers[0]).toMatchObject({ id: "clipart", x: 123 });
  });

  it("ignores an order that does not name exactly the layers the template drew", () => {
    const s = unicornSet();
    // A stale order — the template has six layers, this names five.
    s.input.members[0].order = ["clipart", "numeral", "top", "ordinal", "occasion"];
    expect(stack(s)).toEqual(stack());
  });

  it("ignores an order naming a layer the template never drew", () => {
    const s = unicornSet();
    s.input.members[0].order = ["nope", "clipart", "numeral", "top", "ordinal", "occasion", "bottom"];
    expect(stack(s)).toEqual(stack());
  });
});
