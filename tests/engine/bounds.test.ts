import { describe, it, expect } from "vitest";
import { layerBounds, DESCENDER_RATIO } from "@/engine";
import type { TextLayer } from "@/engine";

const t: TextLayer = { id: "t", type: "text", text: "Ayah", font: "Fredoka", weight: 700, size: 100, color: "#000000", align: "center", x: 100, y: 200, maxWidth: 400, lines: 1 };

describe("layerBounds (ink-aware)", () => {
  it("adds a descender allowance", () => {
    expect(layerBounds(t)).toEqual({ x: 100, y: 200, w: 400, h: 100 * (1 + DESCENDER_RATIO) });
  });
  it("expands by stroke width on every side", () => {
    expect(layerBounds({ ...t, stroke: { color: "#000000", width: 10 } })).toEqual({ x: 90, y: 190, w: 420, h: 125 + 20 });
  });
  it("leaves image bounds untouched", () => {
    expect(layerBounds({ id: "i", type: "image", src: "x", x: 10, y: 20, w: 30, h: 40 })).toEqual({ x: 10, y: 20, w: 30, h: 40 });
  });
  it("scales the allowance with the line count", () => {
    expect(layerBounds({ ...t, lines: 2 })).toEqual({ x: 100, y: 200, w: 400, h: 250 });
  });
});
