import type { Design, ImageLayer, Member, Set, TextLayer } from "../types";
import { canvasFor, layerBounds, safeArea } from "../sizing";
import { fitText, type TextMeasurer } from "../textFit";
import { resolveLines } from "../wording";
import { displayText } from "../text";

export type TemplateContext = { measure: TextMeasurer; clipart: { w: number; h: number } };

const MIN_SIZE_FRACTION = 0.04;

/**
 * The composition's width as a fraction of its height, taken from `docs/samples/single_ayah.png`
 * (2630 x 3389). The artwork the shop is copying is a portrait block; the canvas is not, because
 * `canvasFor` describes the print *envelope* — the largest square that fits the garment's size
 * class. So the block is laid out portrait inside that square and the side margins fall where the
 * ratio puts them, rather than the envelope being reshaped and every size rule with it.
 */
export const SAMPLE_RATIO = 0.776;

/**
 * The numeral's starting height as a fraction of the block, and the value the layout is built
 * around: it is the tallest thing on the shirt and everything else is placed against it. A digit
 * reserves no descender (see `layerBounds`), so its box is exactly `size` tall and must fit between
 * the top of the block and `BASELINE` — keep the two together under 1.
 */
export const NUMERAL_START_FRACTION = 0.81;
/** Slack the bottom clamp keeps between a text layer's ink bottom and the safe-area bottom. */
const CLAMP_MARGIN_FRACTION = 0.005;

/**
 * The line the numeral and the clipart both stand on, as a fraction of the block.
 *
 * The numeral is placed by its foot rather than its head, and for the same reason the clipart is:
 * a wide age shrinks to fit its column, and a box pinned by its top would float such a numeral up
 * into the name across the top of the shirt. Pinned by the foot it stays where the eye expects it
 * whatever digit it holds, and a "5" reads as a shorter "1" rather than as a different layout.
 */
const BASELINE = 0.83;

export function collage(set: Set, member: Member, ctx: TemplateContext): Design {
  const canvas = canvasFor(member.sizeClass);
  const S = canvas.w;
  const A = safeArea(canvas);
  const { font, palette } = set.style;
  const lines = resolveLines(set, member);
  const minSize = S * MIN_SIZE_FRACTION;

  // The portrait block: the full height it is allowed, and whatever width the sample's ratio makes
  // of that, centred. `Math.min` is what keeps a future wider envelope from pushing it past the
  // safe edge rather than letterboxing it.
  const H = A.h;
  const W = Math.min(A.w, SAMPLE_RATIO * H);
  const X = A.x + (A.w - W) / 2;
  const Y = A.y;

  // Every line is set in caps, as in the sample. The renderer applies the transform before drawing,
  // so `fitText` has to measure the transformed string or a slot overflows the box it was fitted to.
  const fitted = (id: string, text: string, xf: number, yf: number, widthF: number, startF: number,
    align: TextLayer["align"]): TextLayer => {
    const weight = 900 as const;
    const x = X + xf * W, y = Y + yf * H, maxWidth = widthF * W;
    const { size } = fitText(ctx.measure, {
      text: displayText({ text, transform: "upper" }), font, weight, maxWidth, startSize: startF * H, minSize,
    });
    return { id, type: "text", text, font, weight, size, color: palette.primary, align, x, y, maxWidth, lines: 1, transform: "upper" };
  };

  const numeralText = String(set.input.age);
  const numeralMaxWidth = 0.42 * W;
  // Indonesian gives up a little height to leave the "ke-" a line of its own above the numeral.
  const numeralStart = (NUMERAL_START_FRACTION - (lines.ordinalBeforeNumeral ? 0.06 : 0)) * H;
  const { size: numeralSize } = fitText(ctx.measure, {
    text: numeralText, font, weight: 900, maxWidth: numeralMaxWidth, startSize: numeralStart, minSize,
  });
  const numeralY = Y + BASELINE * H - numeralSize;
  // Stroke scales with the numeral, not the canvas, so a shrunken numeral keeps its proportions.
  const numeralStroke = 0.02 * numeralSize;
  const numeral: TextLayer = {
    id: "numeral", type: "text", text: numeralText, font, weight: 900, size: numeralSize,
    color: palette.secondary, stroke: { color: palette.outline, width: numeralStroke },
    // Inset by the stroke width so the outer half of the outline lands on the block's edge, not past it.
    align: "left", x: X + numeralStroke, y: numeralY, maxWidth: numeralMaxWidth, lines: 1,
  };

  // The clipart sits over the numeral's right shoulder, exactly as in the sample: its left edge is
  // inside the numeral's box, and the two read as one mass rather than two islands. Capped at the
  // block's right edge so a wide clipart cannot push past it.
  // The height stops just short of the bottom band's box top rather than the sample's 0.565: the
  // label has to be able to sit under the artwork, not across it.
  const boxW = 0.625 * W, boxH = 0.535 * H;
  const scale = Math.min(boxW / ctx.clipart.w, boxH / ctx.clipart.h);
  const cw = ctx.clipart.w * scale, ch = ctx.clipart.h * scale;
  // Anchored by its foot, not its head. A portrait clipart fills the slot either way, but a
  // landscape one — the sample's kitty is portrait, a shop's unicorn need not be — is shorter than
  // the slot, and hanging it from the top opens a band of white above the member's label. Sitting
  // it on the same line every time is also what makes a batch of mixed cliparts look like a set.
  const clipart: ImageLayer = { id: "clipart", type: "image", src: set.style.clipartSrc,
    x: Math.min(X + 0.296 * W, X + W - cw), y: Y + (BASELINE - 0.04) * H - ch, w: cw, h: ch };

  // The name runs the width of the block, one band across the very top.
  const top = fitted("top", lines.top, 0.05, 0, 0.90, 0.18, "center");

  const ordinal = lines.ordinalBeforeNumeral
    ? fitted("ordinal", lines.ordinal, 0, 0.17, 0.30, 0.077, "left")
    // Clear of the numeral's column (which ends at 0.42) so a wide digit's shoulder cannot touch
    // it, and still left of "BIRTHDAY", which is where the sample tucks its "st".
    : fitted("ordinal", lines.ordinal, 0.45, 0.215, 0.13, 0.077, "left");

  // "BIRTHDAY" sits up and to the right of the ordinal, tucked against the numeral's shoulder.
  const occasion = fitted("occasion", lines.occasion, 0.525, 0.16, 0.465, 0.10, "left");
  // The member's own label closes the block, as wide as the name that opened it.
  const bottom = fitted("bottom", lines.bottom, 0, 0.79, 1, 0.20, "center");

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
