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
import type { TextLayer } from "@/engine/types";
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
    // ...while the print itself stays opaque on top of the black shirt. Sampled over the numeral's
    // own box rather than at a fixed fraction of the design: the numeral is the one layer whose
    // place the template is free to move, and a magic pixel silently starts probing the margin the
    // moment it does. What is asserted is unchanged — the pale numeral fill is really drawn on top
    // of the black shirt — but it now survives the layout being retuned.
    const k = 400 / shirt.width;
    const designW = maxCm("adult") * shirt.pxPerCm;
    const numeral = d.layers.find(l => l.id === "numeral") as TextLayer;
    const toMockup = (dx: number, dy: number) => ({
      x: Math.round((shirt.chestAnchor.x - designW / 2 + (dx / d.canvas.w) * designW) * k),
      y: Math.round((shirt.chestAnchor.y + (dy / d.canvas.w) * designW) * k),
    });
    let brightest = 0;
    for (let dy = numeral.y; dy < numeral.y + numeral.size; dy += numeral.size / 40) {
      for (let dx = numeral.x; dx < numeral.x + numeral.maxWidth; dx += numeral.maxWidth / 40) {
        const p = toMockup(dx, dy);
        if (p.x < 0 || p.x >= 400 || p.y < 0 || p.y >= 400) continue;
        const i2 = (p.y * 400 + p.x) * 3;
        brightest = Math.max(brightest, data[i2] + data[i2 + 1] + data[i2 + 2]);
      }
    }
    expect(brightest).toBeGreaterThan(200);
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
    expect(expected).toBe(174);                                // 29 cm x 24 px/cm scaled to a 600 px frame
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
