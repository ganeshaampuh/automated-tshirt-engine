import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { renderMockup, loadShirtAsset, defaultShirtFor } from "@/engine/mockup";
import { loadImageFromFile } from "@/engine/render/server";
import { collage } from "@/engine/templates/collage";
import { createNodeMeasurer } from "@/engine/measure";
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
});
