import { describe, it, expect } from "vitest";
import { maxCm, maxPx, canvasFor, safeArea, boundingBox, boundingBoxCm, isWithinSafeArea } from "@/engine/sizing";
import type { Design } from "@/engine/types";

const design = (w: number, layers: Design["layers"]): Design => ({
  version: 2, sizeClass: "adult", canvas: { w, h: w, dpi: 300 }, shirtColor: "#ffffff", layers,
});

describe("sizing table", () => {
  it("max cm per class", () => {
    expect(maxCm("adult")).toBe(29);
    expect(maxCm("kids-0-1")).toBe(18);
    expect(maxCm("kids-1-9")).toBe(20);
  });
  it("max px at 300 dpi", () => {
    expect(maxPx("adult")).toBe(3425);
    expect(maxPx("kids-0-1")).toBe(2126);
    expect(maxPx("kids-1-9")).toBe(2362);
  });
  it("canvas is square", () => {
    expect(canvasFor("kids-1-9")).toEqual({ w: 2362, h: 2362, dpi: 300 });
  });
  it("safe area is 3% inset", () => {
    expect(safeArea({ w: 1000, h: 1000, dpi: 300 })).toEqual({ x: 30, y: 30, w: 940, h: 940 });
  });
});

describe("bounding box", () => {
  it("unions image and text layers", () => {
    const d = design(3425, [
      { id: "a", type: "image", src: "x", x: 100, y: 200, w: 500, h: 400 },
      { id: "b", type: "text", text: "Hi", font: "Fredoka", weight: 700, size: 100, color: "#000", align: "center", x: 50, y: 900, maxWidth: 800, lines: 1 },
    ]);
    // The text layer's box bottom includes the descender allowance: 900 + 100 * 1.25 = 1025.
    expect(boundingBox(d)).toEqual({ x: 50, y: 200, w: 800, h: 825 });
  });
  it("reports cm using 300 dpi", () => {
    const d = design(3425, [{ id: "a", type: "image", src: "x", x: 0, y: 0, w: 3425, h: 1000 }]);
    const cm = boundingBoxCm(d);
    expect(cm.w).toBeCloseTo(29, 1);
    expect(cm.h).toBeCloseTo(8.47, 1);
    expect(cm.longest).toBeCloseTo(29, 1);
  });
  it("detects layers outside safe area", () => {
    const inside = design(1000, [{ id: "a", type: "image", src: "x", x: 30, y: 30, w: 100, h: 100 }]);
    const outside = design(1000, [{ id: "a", type: "image", src: "x", x: 20, y: 30, w: 100, h: 100 }]);
    expect(isWithinSafeArea(inside)).toBe(true);
    expect(isWithinSafeArea(outside)).toBe(false);
  });
});
