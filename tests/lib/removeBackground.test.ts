import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { removeBackground, isBackgroundRemovable } from "@/lib/removeBackground";

/** A `size` canvas of `bg`, with a `motif` square of `w`x`w` centred on it. */
async function onBackground(bg: string, motif: string, size = 100, w = 30): Promise<Buffer> {
  const o = Math.round((size - w) / 2);
  return sharp({ create: { width: size, height: size, channels: 4, background: bg } })
    .composite([{
      input: await sharp({ create: { width: w, height: w, channels: 4, background: motif } }).png().toBuffer(),
      left: o, top: o,
    }])
    .png()
    .toBuffer();
}

const alphaAt = async (png: Buffer, x: number, y: number) => {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return data[(y * info.width + x) * info.channels + 3];
};

describe("removeBackground", () => {
  it("lifts a solid colour background", async () => {
    // A small motif on a big canvas: the fill legitimately claims ~0.9 of the frame, so the
    // "it ate the image" ceiling has to clear that. This case is why the ceiling is not 0.9.
    const out = await removeBackground(await onBackground("#ffffff", "#e6007e"));
    const meta = await sharp(out).metadata();
    // trimmed down to the motif
    expect(meta.width).toBeLessThan(40);
    expect(meta.height).toBeLessThan(40);
    // ...and what is left is the artwork, opaque
    expect(await alphaAt(out, Math.floor((meta.width ?? 2) / 2), Math.floor((meta.height ?? 2) / 2))).toBe(255);
  }, 20_000);

  it("reads the key colour off the border instead of assuming white", async () => {
    const out = await removeBackground(await onBackground("#1e5aa8", "#ffd400"));
    expect((await sharp(out).metadata()).width).toBeLessThan(40);
  }, 20_000);

  it("keeps white that the drawing encloses", async () => {
    // The eye of a character, the gleam on a horn: enclosed by ink, so the fill never reaches it.
    // A global "near-white becomes transparent" pass punches a hole here instead.
    const size = 100, ring = 60, hole = 20;
    const ringO = (size - ring) / 2, holeO = (size - hole) / 2;
    const png = await sharp({ create: { width: size, height: size, channels: 4, background: "#ffffff" } })
      .composite([
        { input: await sharp({ create: { width: ring, height: ring, channels: 4, background: "#e6007e" } }).png().toBuffer(), left: ringO, top: ringO },
        { input: await sharp({ create: { width: hole, height: hole, channels: 4, background: "#ffffff" } }).png().toBuffer(), left: holeO, top: holeO },
      ])
      .png()
      .toBuffer();

    const out = await removeBackground(png);
    const meta = await sharp(out).metadata();
    expect(await alphaAt(out, Math.floor((meta.width ?? 2) / 2), Math.floor((meta.height ?? 2) / 2))).toBe(255);
  }, 20_000);

  it("leaves an image somebody already cut out alone, beyond trimming it", async () => {
    const size = 100, w = 30, o = (size - w) / 2;
    const png = await sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: await sharp({ create: { width: w, height: w, channels: 4, background: "#e6007e" } }).png().toBuffer(), left: o, top: o }])
      .png()
      .toBuffer();

    const out = await removeBackground(png);
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(w);
    expect(meta.height).toBe(w);
    expect(await alphaAt(out, 1, 1)).toBe(255);
  }, 20_000);

  it("returns the original when there was no flat background to lift", async () => {
    // Noise on the border means a photograph or a gradient. Keeping that mask tears holes in it, so
    // the shop gets its picture back untouched and can cut it out by hand.
    const size = 100;
    const noise = Buffer.alloc(size * size * 4);
    for (let p = 0; p < size * size; p++) {
      noise[p * 4] = (p * 37) % 256;
      noise[p * 4 + 1] = (p * 91) % 256;
      noise[p * 4 + 2] = (p * 13) % 256;
      noise[p * 4 + 3] = 255;
    }
    const png = await sharp(noise, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();

    expect(await removeBackground(png)).toEqual(png);
  }, 20_000);

  it("survives an image that is background all the way through", async () => {
    // The fill claims everything and `.trim()` has nothing to keep — it must not throw at the shop.
    const png = await sharp({ create: { width: 60, height: 60, channels: 4, background: "#ffffff" } }).png().toBuffer();
    await expect(removeBackground(png)).resolves.toBeInstanceOf(Buffer);
  }, 20_000);
});

describe("isBackgroundRemovable", () => {
  it("keeps a cut-out whose border was flat and which found artwork to stop at", () => {
    expect(isBackgroundRemovable({ borderMatchRatio: 1, filledRatio: 0.9 })).toBe(true);
  });

  it("clears the small-motif-on-a-big-canvas case with room to spare", () => {
    // The "lifts a solid colour background" case above sits at ~0.9; the ceiling must not reject it.
    expect(isBackgroundRemovable({ borderMatchRatio: 1, filledRatio: 0.95 })).toBe(true);
  });

  it("refuses a border that was never flat", () => {
    expect(isBackgroundRemovable({ borderMatchRatio: 0.5, filledRatio: 0.5 })).toBe(false);
  });

  it("refuses a fill that ate the whole image", () => {
    expect(isBackgroundRemovable({ borderMatchRatio: 1, filledRatio: 0.99 })).toBe(false);
  });
});
