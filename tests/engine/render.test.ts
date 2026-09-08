import { describe, it, expect } from "vitest";
import { PNG } from "pngjs";
import { renderDesign, loadImageFromFile } from "@/engine/render/server";
import { collage } from "@/engine/templates/collage";
import { createNodeMeasurer } from "@/engine/measure";
import { unicornSet, CLIPART_SIZE } from "../fixtures/set-unicorn";
import { expectGolden } from "./golden";
import type { Design } from "@/engine/types";

const ctx = { measure: createNodeMeasurer(), clipart: CLIPART_SIZE };
const opts = { scale: 0.2, loadImage: loadImageFromFile };

describe("renderDesign", () => {
  it("renders at the requested scale with transparent background", async () => {
    const d = collage(unicornSet(), unicornSet().input.members[0], ctx);
    const png = PNG.sync.read(await renderDesign(d, opts));
    expect(png.width).toBe(Math.round(3425 * 0.2));
    expect(png.data[3]).toBe(0); // top-left pixel alpha
  });

  it("draws stroke under fill", async () => {
    const d: Design = { version: 2, sizeClass: "adult", canvas: { w: 500, h: 500, dpi: 300 }, shirtColor: "#ffffff",
      layers: [{ id: "n", type: "text", text: "5", font: "Fredoka", weight: 700, size: 400, color: "#ff0000",
        stroke: { color: "#0000ff", width: 30 }, align: "center", x: 0, y: 30, maxWidth: 500, lines: 1 }] };
    const png = PNG.sync.read(await renderDesign(d, { scale: 1, loadImage: loadImageFromFile }));
    let red = 0, blue = 0;
    for (let i = 0; i < png.data.length; i += 4) {
      if (png.data[i + 3] < 200) continue;
      if (png.data[i] > 200 && png.data[i + 2] < 60) red++;
      if (png.data[i + 2] > 200 && png.data[i] < 60) blue++;
    }
    expect(red).toBeGreaterThan(1000);
    expect(blue).toBeGreaterThan(1000);
  });

  it("matches goldens for every member, en and id", async () => {
    for (const lang of ["en", "id"] as const) {
      const s = unicornSet(lang);
      for (const m of s.input.members) {
        const buf = await renderDesign(collage(s, m, ctx), opts);
        expectGolden(`collage-${lang}-${m.id}`, buf);
      }
    }
  }, 60_000);
});
