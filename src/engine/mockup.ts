import sharp from "sharp";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { SizeClassSchema, type Design, type SizeClass } from "./types";
import { maxCm } from "./sizing";
import { renderDesign, type RenderOpts } from "./render/server";

export const ShirtAssetSchema = z.object({
  id: z.string().min(1),
  sizeClass: SizeClassSchema,
  image: z.string().min(1),
  pxPerCm: z.number().positive(),
  chestAnchor: z.object({ x: z.number(), y: z.number() }),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type ShirtAsset = z.infer<typeof ShirtAssetSchema>;

const MOCKUP_DIR = path.join(process.cwd(), "public", "mockups");

export async function loadShirtAsset(id: string, dir: string = MOCKUP_DIR): Promise<ShirtAsset> {
  const file = path.join(dir, `${id}.json`);
  let json: unknown;
  try {
    json = JSON.parse(await readFile(file, "utf8"));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`shirt asset "${id}" could not be read from ${file}: ${message}`);
  }
  const parsed = ShirtAssetSchema.safeParse(json);
  if (!parsed.success) throw new Error(`shirt asset "${id}" is invalid: ${parsed.error.message}`);
  return parsed.data;
}

export function defaultShirtFor(sizeClass: SizeClass): string {
  return sizeClass === "adult" ? "adult-flat" : "kids-flat";
}

function hexToRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export async function renderMockup(design: Design, shirt: ShirtAsset, opts: { loadImage: RenderOpts["loadImage"]; width?: number }): Promise<Buffer> {
  if (shirt.sizeClass !== design.sizeClass) {
    throw new Error(
      `shirt asset "${shirt.id}" is for size class "${shirt.sizeClass}" but the design is "${design.sizeClass}"; ` +
      `pick a shirt with defaultShirtFor(design.sizeClass)`,
    );
  }
  const outW = opts.width ?? 2000;
  const base = await sharp(path.join(MOCKUP_DIR, shirt.image)).ensureAlpha().png().toBuffer();

  // 1. tint white base with shirt color (multiply keeps shading/outline), then mask the result back to
  //    the shirt's own alpha — multiply over transparent pixels would otherwise flood the whole frame.
  const tint = await sharp({ create: { width: shirt.width, height: shirt.height, channels: 4, background: { ...hexToRgb(design.shirtColor), alpha: 1 } } }).png().toBuffer();
  const shirtPng = await sharp(base)
    .composite([{ input: tint, blend: "multiply" }, { input: base, blend: "dest-in" }])
    .png()
    .toBuffer();

  // 2. render design at real-world scale
  const scale = (shirt.pxPerCm * maxCm(design.sizeClass)) / design.canvas.w;
  const designPng = await renderDesign(design, { scale, background: null, loadImage: opts.loadImage });
  const designW = Math.round(design.canvas.w * scale);
  const left = Math.round(shirt.chestAnchor.x - designW / 2);
  const top = Math.round(shirt.chestAnchor.y);

  // 3. composite the print over the shirt: a real print is opaque ink, so "over" — "multiply" would
  //    let a dark shirt swallow the design. (The shirt tint above still multiplies, to keep shading.)
  //    sharp resizes before compositing within one pipeline, so the resize runs in a second pass.
  const composed = await sharp(shirtPng)
    .composite([{ input: designPng, left, top, blend: "over" }])
    .png()
    .toBuffer();

  return sharp(composed)
    .flatten({ background: "#f3f3f3" })
    .resize({ width: outW })
    .jpeg({ quality: 88 })
    .toBuffer();
}
