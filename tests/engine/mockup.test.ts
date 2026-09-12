import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { renderMockup, loadShirtAsset, defaultShirtFor } from "@/engine/mockup";
import { loadImageFromFile } from "@/engine/render/server";
import { collage } from "@/engine/templates/collage";
import { createNodeMeasurer } from "@/engine/measure";
import { canvasFor, maxCm } from "@/engine/sizing";
import type { Design } from "@/engine/types";
import { unicornSet, CLIPART_SIZE } from "../fixtures/set-unicorn";
import { expectGolden } from "./golden";

const ctx = { measure: createNodeMeasurer(), clipart: CLIPART_SIZE };

describe("mockup", () => {
  it("picks a shirt per size class", () => {
    expect(defaultShirtFor("adult")).toBe("adult-flat");
    expect(defaultShirtFor("kids-1-9")).toBe("kids-flat");
    expect(defaultShirtFor("kids-0-1")).toBe("kids-flat");
  });

  it("renders a jpeg at the requested width", async () => {
    const s = unicornSet();
    const d = collage(s, s.input.members[0], ctx);
    const shirt = await loadShirtAsset("adult-flat");
    const jpg = await renderMockup(d, shirt, { loadImage: loadImageFromFile, width: 800 });
    const meta = await sharp(jpg).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(800);
  }, 30_000);

  it("tints the shirt with shirtColor", async () => {
    const s = unicornSet();
    s.input.shirtColor = "#000000";
    const d = collage(s, s.input.members[0], ctx);
    const shirt = await loadShirtAsset("adult-flat");
    const jpg = await renderMockup(d, shirt, { loadImage: loadImageFromFile, width: 400 });
    const { data } = await sharp(jpg).raw().toBuffer({ resolveWithObject: true });
    // sample a pixel in the lower body of the shirt, below the design
    const x = 200, y = 360, i = (y * 400 + x) * 3;
    expect(data[i]).toBeLessThan(40);
    // ...while the print itself stays opaque on top of the black shirt: sample the numeral fill
    // (secondary pink) near the left of the design and require it to be far from black.
    const k = 400 / shirt.width;
    const designW = maxCm("adult") * shirt.pxPerCm;
    const nx = Math.round((shirt.chestAnchor.x - designW / 2 + designW * 0.12) * k);
    const ny = Math.round((shirt.chestAnchor.y + designW * 0.45) * k);
    const n = (ny * 400 + nx) * 3;
    expect(data[n] + data[n + 1] + data[n + 2]).toBeGreaterThan(200);
    // ...and the ground outside the silhouette must stay the flatten background, not the shirt colour
    const o = (5 * 400 + 5) * 3;
    expect(data[o]).toBeGreaterThan(230);
    expect(data[o + 1]).toBeGreaterThan(230);
    expect(data[o + 2]).toBeGreaterThan(230);
  }, 30_000);

  it("scales the design to real-world centimetres", async () => {
    // a design that is one solid black layer filling the canvas: its printed width is exactly maxCm
    const swatch = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
    const canvas = canvasFor("adult");
    const design: Design = {
      version: 2, sizeClass: "adult", canvas, shirtColor: "#ffffff",
      layers: [{ id: "block", type: "image", src: `data:image/png;base64,${swatch.toString("base64")}`, x: 0, y: 0, w: canvas.w, h: canvas.h }],
    };
    const shirt = await loadShirtAsset("adult-flat");
    const outW = 600;
    const jpg = await renderMockup(design, shirt, { loadImage: loadImageFromFile, width: outW });
    const { data, info } = await sharp(jpg).raw().toBuffer({ resolveWithObject: true });

    const k = outW / shirt.width;
    const designPx = maxCm("adult") * shirt.pxPerCm;          // design width in shirt pixels
    const row = Math.round((shirt.chestAnchor.y + designPx / 2) * k); // mid-height of the block
    let dark = 0;
    for (let x = 0; x < info.width; x++) if (data[(row * info.width + x) * info.channels] < 128) dark++;

    const expected = Math.round(designPx * k);
    expect(expected).toBe(187);                                // 29 cm x 25.85 px/cm scaled to a 600 px frame
    expect(Math.abs(dark - expected)).toBeLessThanOrEqual(2);
  }, 30_000);

  it("matches goldens for adult and kids", async () => {
    const s = unicornSet();
    for (const idx of [0, 1]) {
      const m = s.input.members[idx];
      const d = collage(s, m, ctx);
      const shirt = await loadShirtAsset(defaultShirtFor(m.sizeClass));
      expectGolden(`mockup-${m.id}`, await sharp(await renderMockup(d, shirt, { loadImage: loadImageFromFile, width: 600 })).png().toBuffer());
    }
  }, 60_000);

  it("matches the golden for a dark shirt", async () => {
    const s = unicornSet();
    s.input.shirtColor = "#1f2937";
    const m = s.input.members[0];
    const d = collage(s, m, ctx);
    const shirt = await loadShirtAsset(defaultShirtFor(m.sizeClass));
    expectGolden(`mockup-${m.id}-dark`, await sharp(await renderMockup(d, shirt, { loadImage: loadImageFromFile, width: 600 })).png().toBuffer());
  }, 30_000);

  it("shades the print with the fabric, not just the shirt", async () => {
    // The shade layer is darkest at the sides and neutral over the middle of the chest, so a design
    // that fills the print area comes out darker at its edges than at its centre.
    const swatch = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer();
    const canvas = canvasFor("adult");
    const design: Design = {
      version: 2, sizeClass: "adult", canvas, shirtColor: "#ffffff",
      layers: [{ id: "block", type: "image", src: `data:image/png;base64,${swatch.toString("base64")}`, x: 0, y: 0, w: canvas.w, h: canvas.h }],
    };
    const shirt = await loadShirtAsset("adult-flat");
    expect(shirt.shade).toBe("adult-flat-shade.png");

    const outW = 600;
    const jpg = await renderMockup(design, shirt, { loadImage: loadImageFromFile, width: outW });
    const { data, info } = await sharp(jpg).raw().toBuffer({ resolveWithObject: true });

    const k = outW / shirt.width;
    const designPx = maxCm("adult") * shirt.pxPerCm;
    const row = Math.round((shirt.chestAnchor.y + designPx / 2) * k);
    const at = (x: number) => data[(row * info.width + Math.round(x)) * info.channels];
    const mid = at(shirt.chestAnchor.x * k);
    const edge = at((shirt.chestAnchor.x - designPx / 2) * k + 3);
    expect(mid).toBeGreaterThan(edge);          // a flat white print would leave these equal
    expect(mid).toBeGreaterThan(200);           // ...while the middle stays close to white
  }, 30_000);

  it("names the asset when the sidecar is missing", async () => {
    await expect(loadShirtAsset("no-such-shirt")).rejects.toThrow(/no-such-shirt/);
  });

  it("rejects a sidecar with an unknown size class", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "shirt-asset-"));
    await writeFile(path.join(dir, "bogus.json"), JSON.stringify({
      id: "bogus", sizeClasses: ["xl"], image: "bogus.png", pxPerCm: 24,
      chestAnchor: { x: 10, y: 10 }, width: 100, height: 100,
    }));
    await expect(loadShirtAsset("bogus", dir)).rejects.toThrow(/shirt asset "bogus" is invalid/);
  });

  it("names the asset when the sidecar is malformed JSON", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "shirt-asset-"));
    await writeFile(path.join(dir, "broken.json"), "{ not json");
    await expect(loadShirtAsset("broken", dir)).rejects.toThrow(/shirt asset "broken" could not be read/);
  });

  it("refuses a shirt whose size classes don't include the design's", async () => {
    const s = unicornSet();
    const kid = s.input.members[1];
    const d = collage(s, kid, ctx);                       // kids-1-9
    const shirt = await loadShirtAsset("adult-flat");     // [adult]
    await expect(renderMockup(d, shirt, { loadImage: loadImageFromFile, width: 200 })).rejects.toThrow(
      /shirt asset "adult-flat" serves \[adult\] but the design is "kids-1-9"/,
    );
  }, 30_000);

  it("accepts kids-0-1 and kids-1-9 designs on the shared kids-flat shirt", async () => {
    const s = unicornSet();
    const shirt = await loadShirtAsset("kids-flat");
    for (const sizeClass of ["kids-0-1", "kids-1-9"] as const) {
      const kid = { ...s.input.members[1], sizeClass };
      const d = collage(s, kid, ctx);
      await expect(renderMockup(d, shirt, { loadImage: loadImageFromFile, width: 200 })).resolves.toBeInstanceOf(Buffer);
    }
  }, 30_000);
});
