import type { Design, ImageLayer, Member, Set, TextLayer } from "../types";
import { canvasFor, safeArea } from "../sizing";
import { fitText, type TextMeasurer } from "../textFit";
import { resolveLines } from "../wording";

export type TemplateContext = { measure: TextMeasurer; clipart: { w: number; h: number } };

const MIN_SIZE_FRACTION = 0.04;

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
    const { size } = fitText(ctx.measure, { text, font, weight, maxWidth, startSize, minSize });
    return { id, type: "text", text, font, weight, size, color: palette.primary, align, x, y, maxWidth, lines: 1, ...extra };
  };

  const numeralY = lines.ordinalBeforeNumeral ? 0.26 * S : 0.22 * S;
  const numeral: TextLayer = {
    id: "numeral", type: "text", text: String(set.input.age), font, weight: 700, size: 0.60 * S,
    color: palette.secondary, stroke: { color: palette.outline, width: 0.012 * S },
    align: "left", x: A.x, y: numeralY, maxWidth: 0.42 * S, lines: 1,
  };

  // clipart: fit into a 0.60S x 0.48S box, right-aligned to safe edge, bottom at 0.80S
  const boxW = 0.60 * S, boxH = 0.48 * S;
  const scale = Math.min(boxW / ctx.clipart.w, boxH / ctx.clipart.h);
  const cw = ctx.clipart.w * scale, ch = ctx.clipart.h * scale;
  const clipart: ImageLayer = { id: "clipart", type: "image", src: set.style.clipartSrc,
    x: A.x + A.w - cw, y: 0.80 * S - ch, w: cw, h: ch };

  const top = fitted("top", lines.top, A.x, A.y, A.w, 0.13 * S, "center");

  const ordinal = lines.ordinalBeforeNumeral
    ? fitted("ordinal", lines.ordinal, A.x, 0.18 * S, 0.30 * S, 0.07 * S, "left")
    : fitted("ordinal", lines.ordinal, 0.44 * S, 0.26 * S, 0.14 * S, 0.07 * S, "left", { transform: "upper" });

  const occasion = fitted("occasion", lines.occasion, 0.44 * S, 0.34 * S, A.x + A.w - 0.44 * S, 0.11 * S, "left");
  const bottom = fitted("bottom", lines.bottom, A.x, 0.82 * S, A.w, 0.16 * S, "center");

  // Clamp any text layer whose baseline box would exceed the safe bottom.
  for (const t of [top, ordinal, occasion, bottom]) {
    if (t.y + t.size > A.y + A.h) t.y = A.y + A.h - t.size;
  }

  return { version: 2, sizeClass: member.sizeClass, canvas, shirtColor: set.input.shirtColor,
    layers: [numeral, clipart, top, ordinal, occasion, bottom] };
}
