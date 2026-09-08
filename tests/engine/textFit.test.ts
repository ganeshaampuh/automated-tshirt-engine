import { describe, it, expect } from "vitest";
import { fitText, type TextMeasurer } from "@/engine/textFit";
import { createNodeMeasurer } from "@/engine/measure";

// deterministic fake: every glyph is 0.6em wide
const fake: TextMeasurer = { width: (t, _f, _w, size, ls = 0) => t.length * size * 0.6 + (t.length - 1) * ls };

describe("fitText", () => {
  it("keeps start size when it already fits", () => {
    expect(fitText(fake, { text: "Hi", font: "Fredoka", weight: 700, maxWidth: 1000, startSize: 100, minSize: 20 }).size).toBe(100);
  });
  it("shrinks until it fits", () => {
    const r = fitText(fake, { text: "Muhammad Rizky Ramadhan", font: "Fredoka", weight: 700, maxWidth: 600, startSize: 200, minSize: 20 });
    expect(r.width).toBeLessThanOrEqual(600);
    expect(fake.width("Muhammad Rizky Ramadhan", "Fredoka", 700, r.size + 1)).toBeGreaterThan(600);
  });
  it("floors at minSize", () => {
    expect(fitText(fake, { text: "x".repeat(200), font: "Fredoka", weight: 700, maxWidth: 100, startSize: 200, minSize: 40 }).size).toBe(40);
  });
  it("never returns below a non-integer minSize", () => {
    const r = fitText(fake, { text: "x".repeat(200), font: "Fredoka", weight: 700, maxWidth: 100, startSize: 200, minSize: 85.04 });
    expect(r.size).toBeGreaterThanOrEqual(85.04);
    expect(r.size).toBe(86);
  });
  it("clamps to startSize when minSize exceeds startSize", () => {
    const r = fitText(fake, { text: "Hi", font: "Fredoka", weight: 700, maxWidth: 1000, startSize: 50, minSize: 100 });
    expect(r.size).toBeLessThanOrEqual(50);
  });
  it("node measurer measures real fonts", () => {
    const m = createNodeMeasurer();
    const w = m.width("Keisya", "Fredoka", 700, 100);
    // the bold face, not the regular one — see fontWeight.test.ts
    expect(w).not.toBeCloseTo(m.width("Keisya", "Fredoka", 400, 100), 1);
    expect(w).toBeGreaterThan(200);
    expect(w).toBeLessThan(500);
    expect(m.width("Keisya", "Fredoka", 700, 200)).toBeCloseTo(w * 2, 0);
  });
});
