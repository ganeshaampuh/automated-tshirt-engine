import type { Design, ImageLayer, Member, Set, TextLayer } from "../types";
import { canvasFor, layerBounds, safeArea } from "../sizing";
import { fitText, type TextMeasurer } from "../textFit";
import { resolveLines } from "../wording";
import { displayText } from "../text";

export type TemplateContext = { measure: TextMeasurer; clipart: { w: number; h: number } };

const MIN_SIZE_FRACTION = 0.04;
// The numeral is the tallest element, so its start size sets the bottom slack: under the ink model
// its box runs 1.27 * size below `numeralY` (1.25 descender allowance + both stroke halves).
export const NUMERAL_START_FRACTION = 0.54;
/** Slack the bottom clamp keeps between a text layer's ink bottom and the safe-area bottom. */
const CLAMP_MARGIN_FRACTION = 0.005;

export function collage(set: Set, member: Member, ctx: TemplateContext): Design {
  const canvas = canvasFor(member.sizeClass);
  const S = canvas.w;
  const A = safeArea(canvas);
  const { font, palette } = set.style;
  const lines = resolveLines(set, member);
  const minSize = S * MIN_SIZE_FRACTION;

  const fitted = (id: string, text: string, x: number, y: number, maxWidth: number, startSize: number,
    align: TextLayer["align"], extra: Partial<TextLayer> = {}): TextLayer => {
    const weight = 700 as const;
    // Measure what the renderer will actually draw: `transform: "upper"` is applied before drawing.
    const { size } = fitText(ctx.measure, { text: displayText({ text, transform: extra.transform }), font, weight, maxWidth, startSize, minSize });
    return { id, type: "text", text, font, weight, size, color: palette.primary, align, x, y, maxWidth, lines: 1, ...extra };
  };

  const numeralY = lines.ordinalBeforeNumeral ? 0.26 * S : 0.22 * S;
  const numeralText = String(set.input.age);
  const numeralMaxWidth = 0.42 * S;
  const { size: numeralSize } = fitText(ctx.measure, {
    text: numeralText, font, weight: 700, maxWidth: numeralMaxWidth, startSize: NUMERAL_START_FRACTION * S, minSize,
  });
  // Stroke scales with the numeral, not the canvas, so a shrunken numeral keeps its proportions.
  const numeralStroke = 0.02 * numeralSize;
  const numeral: TextLayer = {
    id: "numeral", type: "text", text: numeralText, font, weight: 700, size: numeralSize,
    color: palette.secondary, stroke: { color: palette.outline, width: numeralStroke },
    // Inset by the stroke width so the outer half of the outline lands on the safe edge, not past it.
    align: "left", x: A.x + numeralStroke, y: numeralY, maxWidth: numeralMaxWidth, lines: 1,
  };

  // clipart: fit into a 0.60S x 0.35S box, bottom at 0.78S — above the bottom slot's ink top (0.795S)
  // and below the occasion's ink bottom (0.425S). Its left edge sits at 0.37S so it overlaps the
  // right of the numeral box (which ends at A.x + 0.42S), but never runs past the safe right edge.
  const boxW = 0.60 * S, boxH = 0.35 * S;
  const scale = Math.min(boxW / ctx.clipart.w, boxH / ctx.clipart.h);
  const cw = ctx.clipart.w * scale, ch = ctx.clipart.h * scale;
  const clipart: ImageLayer = { id: "clipart", type: "image", src: set.style.clipartSrc,
    x: Math.min(0.37 * S, A.x + A.w - cw), y: 0.78 * S - ch, w: cw, h: ch };

  // The top slot carries no stroke, but keep 1% of air above it so the ascenders never touch the edge.
  const top = fitted("top", lines.top, A.x, A.y + 0.012 * S, A.w, 0.13 * S, "center");

  const ordinal = lines.ordinalBeforeNumeral
    ? fitted("ordinal", lines.ordinal, A.x, 0.18 * S, 0.30 * S, 0.07 * S, "left")
    : fitted("ordinal", lines.ordinal, 0.44 * S, 0.21 * S, 0.14 * S, 0.07 * S, "left", { transform: "upper" });

  // occasion sits above the clipart: y 0.30S + ink height 0.10S * 1.25 ends at 0.425S, clear of the
  // clipart top (0.43S).
  const occasion = fitted("occasion", lines.occasion, 0.44 * S, 0.30 * S, A.x + A.w - 0.44 * S, 0.10 * S, "left");
  // Bottom slot: 0.80S + 0.14S * 1.25 descender allowance = 0.975S, inside the 0.97S safe bottom
  // once the clamp below nudges it up.
  const bottom = fitted("bottom", lines.bottom, A.x, 0.80 * S, A.w, 0.14 * S, "center");

  // `y` is the top of the text box (the renderer draws with textBaseline "top"), so clamp the box
  // top upwards for any layer whose box would otherwise run past the safe bottom. Clamp to half a
  // percent inside that edge rather than onto it: landing exactly on the boundary leaves the slot
  // with zero slack, and any later nudge would push `exportPrintPng` into an ExportError.
  const clampBottom = A.y + A.h - CLAMP_MARGIN_FRACTION * S;
  for (const t of [top, ordinal, occasion, bottom]) {
    const b = layerBounds(t);
    if (b.y + b.h > clampBottom) t.y -= (b.y + b.h) - clampBottom;
  }

  return { version: 2, sizeClass: member.sizeClass, canvas, shirtColor: set.input.shirtColor,
    layers: [numeral, clipart, top, ordinal, occasion, bottom] };
}
