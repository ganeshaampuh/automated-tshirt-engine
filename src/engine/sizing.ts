import type { Canvas, Design, Layer, SizeClass } from "./types";

const MAX_CM: Record<SizeClass, number> = { adult: 29, "kids-0-1": 18, "kids-1-9": 20 };
export const DPI = 300;
const SAFE_INSET = 0.03;

export const maxCm = (s: SizeClass) => MAX_CM[s];
export const maxPx = (s: SizeClass) => Math.round((MAX_CM[s] / 2.54) * DPI);
export const canvasFor = (s: SizeClass): Canvas => ({ w: maxPx(s), h: maxPx(s), dpi: DPI });
export const pxToCm = (px: number) => (px / DPI) * 2.54;

export type Rect = { x: number; y: number; w: number; h: number };

export function safeArea(c: Canvas): Rect {
  const x = Math.round(c.w * SAFE_INSET), y = Math.round(c.h * SAFE_INSET);
  return { x, y, w: c.w - 2 * x, h: c.h - 2 * y };
}

export function layerBounds(l: Layer): Rect {
  if (l.type === "image") return { x: l.x, y: l.y, w: l.w, h: l.h };
  return { x: l.x, y: l.y, w: l.maxWidth, h: l.size * (l.lines ?? 1) };
}

export function boundingBox(d: Design): Rect {
  if (d.layers.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const l of d.layers) {
    const b = layerBounds(l);
    x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y);
    x2 = Math.max(x2, b.x + b.w); y2 = Math.max(y2, b.y + b.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export function boundingBoxCm(d: Design) {
  const b = boundingBox(d);
  const w = pxToCm(b.w), h = pxToCm(b.h);
  return { w, h, longest: Math.max(w, h) };
}

export function isWithinSafeArea(d: Design): boolean {
  const s = safeArea(d.canvas);
  return d.layers.every(l => {
    const b = layerBounds(l);
    return b.x >= s.x && b.y >= s.y && b.x + b.w <= s.x + s.w && b.y + b.h <= s.y + s.h;
  });
}
