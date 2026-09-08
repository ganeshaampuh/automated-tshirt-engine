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

/**
 * Extra height below the last baseline box to cover descenders (g, j, p, y) and the diacritics
 * that push a cap-height glyph past its nominal `size`. Applied per line.
 */
export const DESCENDER_RATIO = 0.25;

/** Ink bounds of a layer: the layout box grown by the descender allowance and the stroke width. */
export function layerBounds(l: Layer): Rect {
  if (l.type === "image") return { x: l.x, y: l.y, w: l.w, h: l.h };
  // A stroke is centred on the glyph outline, so its outer half spills `width` past the box on
  // every side once the renderer's line width is accounted for.
  const s = l.stroke?.width ?? 0;
  return {
    x: l.x - s, y: l.y - s,
    w: l.maxWidth + 2 * s,
    h: l.size * (l.lines ?? 1) * (1 + DESCENDER_RATIO) + 2 * s,
  };
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
