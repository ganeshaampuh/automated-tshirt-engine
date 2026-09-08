import sharp from "sharp";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Design, SizeClass } from "./types";
import { maxCm } from "./sizing";
import { renderDesign, type RenderOpts } from "./render/server";

export type ShirtAsset = {
  id: string; sizeClass: SizeClass; image: string; pxPerCm: number;
  chestAnchor: { x: number; y: number }; width: number; height: number;
};

const MOCKUP_DIR = path.join(process.cwd(), "public", "mockups");

export async function loadShirtAsset(id: string): Promise<ShirtAsset> {
  return JSON.parse(await readFile(path.join(MOCKUP_DIR, `${id}.json`), "utf8"));
}

export function defaultShirtFor(sizeClass: SizeClass): string {
  return sizeClass === "adult" ? "adult-flat" : "kids-flat";
}

function hexToRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export async function renderMockup(design: Design, shirt: ShirtAsset, opts: { loadImage: RenderOpts["loadImage"]; width?: number }): Promise<Buffer> {
  const outW = opts.width ?? 2000;
  const base = sharp(path.join(MOCKUP_DIR, shirt.image)).ensureAlpha();

  // 1. tint white base with shirt color (multiply keeps shading/outline)
  const tint = await sharp({ create: { width: shirt.width, height: shirt.height, channels: 4, background: { ...hexToRgb(design.shirtColor), alpha: 1 } } }).png().toBuffer();
  const shirtPng = await base.composite([{ input: tint, blend: "multiply" }]).png().toBuffer();

  // 2. render design at real-world scale
  const scale = (shirt.pxPerCm * maxCm(design.sizeClass)) / design.canvas.w;
  const designPng = await renderDesign(design, { scale, background: null, loadImage: opts.loadImage });
  const designW = Math.round(design.canvas.w * scale);
  const left = Math.round(shirt.chestAnchor.x - designW / 2);
  const top = Math.round(shirt.chestAnchor.y);

  // 3. composite with multiply so fabric texture shows through, then flatten + resize.
  //    sharp resizes before compositing within one pipeline, so the resize runs in a second pass.
  const composed = await sharp(shirtPng)
    .composite([{ input: designPng, left, top, blend: "multiply" }])
    .png()
    .toBuffer();

  return sharp(composed)
    .flatten({ background: "#f3f3f3" })
    .resize({ width: outW })
    .jpeg({ quality: 88 })
    .toBuffer();
}
