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

  it("draws the shadow for text that has no stroke", async () => {
    const layer = (shadow: boolean): Design["layers"][number] => ({
      id: "n", type: "text", text: "5", font: "Fredoka", weight: 700, size: 300, color: "#ff0000",
      ...(shadow ? { shadow: { color: "#000000", blur: 0, dx: 40, dy: 40 } } : {}),
      align: "center", x: 0, y: 30, maxWidth: 500, lines: 1,
    });
    const design = (shadow: boolean): Design => ({ version: 2, sizeClass: "adult",
      canvas: { w: 500, h: 500, dpi: 300 }, shirtColor: "#ffffff", layers: [layer(shadow)] });
    const o = { scale: 1, loadImage: loadImageFromFile };
    const withShadow = PNG.sync.read(await renderDesign(design(true), o));
    const plain = PNG.sync.read(await renderDesign(design(false), o));

    // Pixels the shadow paints outside the glyph: opaque here, fully transparent without the shadow.
    let outside = 0;
    for (let i = 0; i < withShadow.data.length; i += 4) {
      if (withShadow.data[i + 3] > 200 && plain.data[i + 3] === 0) outside++;
    }
    expect(outside).toBeGreaterThan(1000);
  });

  it("names the layer when an image fails to load", async () => {
    const d: Design = { version: 2, sizeClass: "adult", canvas: { w: 100, h: 100, dpi: 300 }, shirtColor: "#ffffff",
      layers: [{ id: "clipart", type: "image", src: "tests/fixtures/does-not-exist.png", x: 0, y: 0, w: 100, h: 100 }] };
    await expect(renderDesign(d, { scale: 1, loadImage: loadImageFromFile })).rejects.toThrow(
      /Failed to load image for layer "clipart" from tests\/fixtures\/does-not-exist\.png: /,
    );
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

  it("matches the golden for a kids-0-1 canvas", async () => {
    const s = unicornSet("en");
    const kid = s.input.members.find(m => m.id === "kid")!;
    kid.sizeClass = "kids-0-1";
    expectGolden("collage-en-kid-0-1", await renderDesign(collage(s, kid, ctx), opts));
  }, 30_000);
});
