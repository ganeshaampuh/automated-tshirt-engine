import { createCanvas, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import { readFile } from "node:fs/promises";
import type { Design, TextLayer, ImageLayer } from "../types";
import { ensureNodeFonts } from "../measure";

export type ImageLike = Image;
export type RenderOpts = { scale?: number; background?: string | null; loadImage: (src: string) => Promise<ImageLike> };

export async function loadImageFromFile(src: string): Promise<Image> {
  if (/^(https?:|data:)/.test(src)) return loadImage(src);
  return loadImage(await readFile(src));
}

export async function renderDesign(design: Design, opts: RenderOpts): Promise<Buffer> {
  ensureNodeFonts();
  const scale = opts.scale ?? 1;
  const W = Math.round(design.canvas.w * scale), H = Math.round(design.canvas.h * scale);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  if (opts.background) { ctx.fillStyle = opts.background; ctx.fillRect(0, 0, W, H); }
  ctx.scale(scale, scale);
  for (const layer of design.layers) {
    if (layer.type === "image") await drawImage(ctx, layer, opts.loadImage);
    else drawText(ctx, layer);
  }
  return canvas.toBuffer("image/png");
}

function withRotation(ctx: SKRSContext2D, cx: number, cy: number, deg: number | undefined, fn: () => void) {
  if (!deg) return fn();
  ctx.save(); ctx.translate(cx, cy); ctx.rotate((deg * Math.PI) / 180); ctx.translate(-cx, -cy); fn(); ctx.restore();
}

async function drawImage(ctx: SKRSContext2D, l: ImageLayer, load: RenderOpts["loadImage"]) {
  const img = await load(l.src);
  withRotation(ctx, l.x + l.w / 2, l.y + l.h / 2, l.rotation, () => ctx.drawImage(img as Image, l.x, l.y, l.w, l.h));
}

export function displayText(l: TextLayer) { return l.transform === "upper" ? l.text.toUpperCase() : l.text; }

function drawText(ctx: SKRSContext2D, l: TextLayer) {
  const text = displayText(l);
  ctx.font = `${l.weight} ${l.size}px "${l.font}"`;
  ctx.textBaseline = "top";
  ctx.textAlign = l.align;
  (ctx as unknown as { letterSpacing?: string }).letterSpacing = `${l.letterSpacing ?? 0}px`;
  const ax = l.align === "left" ? l.x : l.align === "right" ? l.x + l.maxWidth : l.x + l.maxWidth / 2;
  const boxH = l.size * (l.lines ?? 1);
  withRotation(ctx, l.x + l.maxWidth / 2, l.y + boxH / 2, l.rotation, () => {
    ctx.save();
    if (l.shadow) { ctx.shadowColor = l.shadow.color; ctx.shadowBlur = l.shadow.blur; ctx.shadowOffsetX = l.shadow.dx; ctx.shadowOffsetY = l.shadow.dy; }
    if (l.stroke && l.stroke.width > 0) {
      ctx.lineJoin = "round"; ctx.lineWidth = l.stroke.width * 2; ctx.strokeStyle = l.stroke.color;
      ctx.strokeText(text, ax, l.y);
    }
    ctx.shadowColor = "transparent";
    ctx.fillStyle = l.color;
    ctx.fillText(text, ax, l.y);
    ctx.restore();
  });
}
