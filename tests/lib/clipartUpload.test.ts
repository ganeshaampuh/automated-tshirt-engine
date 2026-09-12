import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { processClipartUpload } from "@/lib/clipartUpload";
import { MAX_CLIPART_PX } from "@/lib/upload";

const solid = (w: number, h: number, color: string) =>
  sharp({ create: { width: w, height: h, channels: 4, background: color } }).png().toBuffer();

/** A motif on a flat white ground, the shape a real clipart upload arrives in. */
async function clipart(size: number, motif = 0.3): Promise<Buffer> {
  const w = Math.round(size * motif), o = Math.round((size - w) / 2);
  return sharp({ create: { width: size, height: size, channels: 4, background: "#ffffff" } })
    .composite([{ input: await solid(w, w, "#e6007e"), left: o, top: o }])
    .png()
    .toBuffer();
}

describe("processClipartUpload", () => {
  it("returns a PNG with the dimensions it reports", async () => {
    const { png, width, height } = await processClipartUpload(await clipart(200));
    const meta = await sharp(png).metadata();
    expect(meta.format).toBe("png");
    expect(width).toBe(meta.width);
    expect(height).toBe(meta.height);
  }, 30_000);

  it("caps the longest edge before anything walks the pixels", async () => {
    // The cap comes first because the flood fill is linear in pixels: an 8 MB upload can decode to
    // 100 MP, and that is work storage would only throw away afterwards.
    const tall = await sharp({ create: { width: 200, height: MAX_CLIPART_PX + 800, channels: 4, background: "#e6007e" } })
      .png()
      .toBuffer();
    const { width, height } = await processClipartUpload(tall);
    expect(Math.max(width, height)).toBeLessThanOrEqual(MAX_CLIPART_PX);
  }, 60_000);

  it("does not enlarge an image that is already small", async () => {
    // Upscaling a 64px clipart would only invent detail and cost the shop print quality.
    const { width, height } = await processClipartUpload(await clipart(64));
    expect(Math.max(width, height)).toBeLessThanOrEqual(64);
  }, 30_000);

  it("lifts the background, so what is stored is artwork on transparency", async () => {
    const { png, width, height } = await processClipartUpload(await clipart(200));
    // trimmed to the motif rather than kept as the full white square
    expect(width).toBeLessThan(100);
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const mid = (Math.floor(height / 2) * info.width + Math.floor(width / 2)) * info.channels;
    expect(data[mid + 3]).toBe(255);
  }, 30_000);

  it("hands back a picture it could not cut out rather than a damaged one", async () => {
    const size = 80;
    const noise = Buffer.alloc(size * size * 4);
    for (let p = 0; p < size * size; p++) {
      noise[p * 4] = (p * 37) % 256;
      noise[p * 4 + 1] = (p * 91) % 256;
      noise[p * 4 + 2] = (p * 13) % 256;
      noise[p * 4 + 3] = 255;
    }
    const png = await sharp(noise, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();
    const out = await processClipartUpload(png);
    expect(out.width).toBe(size);
    expect(out.height).toBe(size);
  }, 30_000);
});
