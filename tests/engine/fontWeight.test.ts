import { describe, it, expect } from "vitest";
import { PNG } from "pngjs";
import { fontUrl, nearestWeight, fontWeights } from "@/engine/fonts";
import { createNodeMeasurer, renderDesign } from "@/engine/server";
import type { Design } from "@/engine";

/**
 * The engine ships static instances, one file per weight. These tests are the guard against a
 * variable font sneaking back in: with a variable file skia draws the default instance whatever
 * weight is asked for, so 400 and 700 would measure and ink identically.
 */
describe("font weight", () => {
  it("resolves a weight to the file that actually carries it", () => {
    expect(fontUrl("Fredoka", 700)).toMatch(/Fredoka-Bold\.ttf$/);
    expect(fontUrl("Fredoka", 400)).toMatch(/Fredoka-Regular\.ttf$/);
    expect(fontUrl("Baloo 2", 900)).toMatch(/Baloo2-ExtraBold\.ttf$/);
  });

  it("falls back to the nearest shipped weight for a single-weight family", () => {
    expect(nearestWeight("Chewy", 700)).toBe(400);
    expect(fontUrl("Chewy", 900)).toMatch(/Chewy\.ttf$/);
    expect(fontWeights("Chewy")).toEqual([400]);
    expect(fontWeights("Baloo 2")).toEqual([400, 700, 900]);
  });

  it("the node measurer measures a different face at 700 than at 400", () => {
    const m = createNodeMeasurer();
    const regular = m.width("Keisya", "Fredoka", 400, 100);
    const bold = m.width("Keisya", "Fredoka", 700, 100);
    // Strict inequality, no tolerance: with a variable font the two widths come out bit-identical,
    // so any difference at all proves a second face was loaded.
    expect(bold).not.toBe(regular);
  });

  it("draws heavier ink at 700 than at 400", async () => {
    const design = (weight: 400 | 700): Design => ({
      version: 2,
      sizeClass: "adult",
      shirtColor: "#ffffff",
      canvas: { w: 400, h: 200, dpi: 300 },
      layers: [{
        id: "t", type: "text", text: "Keisya", font: "Fredoka", weight, size: 100,
        color: "#000000", align: "center", x: 0, y: 20, maxWidth: 400, lines: 1,
      }],
    });
    const ink = async (weight: 400 | 700) => {
      const png = PNG.sync.read(await renderDesign(design(weight), { loadImage: async () => { throw new Error("no images"); } }));
      let opaque = 0;
      for (let i = 3; i < png.data.length; i += 4) if (png.data[i] > 128) opaque++;
      return opaque;
    };
    expect(await ink(700)).toBeGreaterThan(await ink(400));
  });
});
