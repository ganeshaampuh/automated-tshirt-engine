import sharp from "sharp";
import type { Design } from "./types";
import { boundingBox, isWithinSafeArea, pxToCm } from "./sizing";
import { renderDesign, type RenderOpts } from "./render/server";

export class ExportError extends Error {}

export async function exportPrintPng(design: Design, loadImage: RenderOpts["loadImage"]) {
  if (!isWithinSafeArea(design)) throw new ExportError("layer outside safe area");
  const full = await renderDesign(design, { scale: 1, background: null, loadImage });
  const b = boundingBox(design);
  const margin = Math.round(Math.max(b.w, b.h) * 0.01);
  const left = Math.max(0, Math.floor(b.x - margin)), top = Math.max(0, Math.floor(b.y - margin));
  const width = Math.min(design.canvas.w - left, Math.ceil(b.w + 2 * margin));
  const height = Math.min(design.canvas.h - top, Math.ceil(b.h + 2 * margin));
  const png = await sharp(full).extract({ left, top, width, height }).png().toBuffer();
  return { png, widthCm: pxToCm(width), heightCm: pxToCm(height) };
}
