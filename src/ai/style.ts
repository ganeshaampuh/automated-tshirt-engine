import { z } from "zod";
import { CURATED_FONTS, DEFAULT_FONT, defaultWording, WordingSchema, type SetInput, type SetStyle } from "@/engine";
import type { AIProvider } from "./provider";
import type { ClipartMeta } from "./clipart";
import { styleSystem, styleUser } from "./prompts";
import { accentColor, contrastRatio, distinct, ensureContrast, tint } from "./palette";

// Re-exported: these moved to `./palette` when the accent picking joined them, and every caller
// already reaches for them here.
export { contrastRatio, ensureContrast };

/**
 * How much lighter the numeral's fill is than its stroke.
 *
 * The reference sample is one colour used twice — a deep magenta outline around a pale magenta
 * fill — and deriving the second from the first is what reproduces that whatever colour the clipart
 * turns out to be. It also guarantees the two can be told apart, which picking two of the clipart's
 * own colours does not: a black-outlined cartoon offers two near-identical darks.
 */
const NUMERAL_TINT = 0.55;

/**
 * The contrast the numeral's fill has to keep against the shirt.
 *
 * Lower than the 3 a text layer has to clear, and deliberately: the numeral is a huge shape with a
 * `primary` stroke around it, so it is legible at a contrast that would be unreadable for a line of
 * type. Holding it to 3 would push every pale fill towards the shirt's opposite and undo the pairing
 * with `primary` that NUMERAL_TINT exists to create.
 */
const FILL_MIN_CONTRAST = 1.6;

/**
 * The numeral's fill, given the stroke it sits inside and the shirt it is printed on.
 *
 * A `wanted` that works is kept — a model that picks the bow's red against the crown's yellow knows
 * something about the artwork that arithmetic does not. It is replaced only when it fails one of
 * the two things a fill cannot fail: being distinguishable from its own stroke, and being visible
 * at all.
 */
function numeralFill(wanted: string | undefined, primary: string, shirtColor: string): string {
  const fallback = ensureContrast(tint(primary, NUMERAL_TINT), shirtColor, FILL_MIN_CONTRAST);
  if (!wanted) return fallback;
  const usable = distinct(wanted, primary) && contrastRatio(wanted, shirtColor) >= FILL_MIN_CONTRAST;
  return usable ? wanted : fallback;
}

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const StyleChoice = z.object({
  font: z.enum(CURATED_FONTS as [string, ...string[]]),
  palette: z.object({ primary: Hex, secondary: Hex, outline: Hex }),
  wording: WordingSchema.partial().optional(),
  rationale: z.string().default(""),
});

/**
 * The palette a clipart implies, on a given shirt: its accent as the stroke, a tint of that accent
 * as the numeral's fill. Everything is derived from one colour, so the result is a coherent shirt
 * rather than two unrelated swatches. See `accentColor` for why the commonest colour in a drawing
 * is the wrong one to build on.
 *
 * This is the one definition of that rule. Both the no-model path (`fallbackStyle`) and the
 * read-colours-on-upload path (`styleWithPalette`) go through it, so the two cannot drift apart —
 * a shop that uploads its own clipart gets the same palette the app would have chosen for it.
 */
export function paletteFromClipart(colors: string[], shirtColor: string): SetStyle["palette"] {
  const primary = ensureContrast(accentColor(colors), shirtColor);
  return { primary, secondary: numeralFill(undefined, primary, shirtColor), outline: primary };
}

/**
 * The style a set gets with no model in the loop: the key is missing, or the call failed twice.
 */
export function fallbackStyle(input: SetInput, clipart: { url: string; meta: ClipartMeta }): SetStyle {
  return {
    template: "collage", font: DEFAULT_FONT,
    palette: paletteFromClipart(clipart.meta.dominantColors, input.shirtColor),
    clipartSrc: clipart.url, wording: defaultWording(input),
  };
}

export async function chooseStyle(input: SetInput, clipart: { url: string; meta: ClipartMeta }, deps: { provider: AIProvider }, note?: string) {
  const base = defaultWording(input);
  const accent = accentColor(clipart.meta.dominantColors);
  let user = styleUser(input, clipart.meta, accent, note);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const c = await deps.provider.chatJSON({ system: styleSystem(CURATED_FONTS), user, schema: StyleChoice });
      const primary = ensureContrast(c.palette.primary, input.shirtColor);
      const style: SetStyle = { template: "collage", font: c.font,
        palette: { primary, secondary: numeralFill(c.palette.secondary, primary, input.shirtColor), outline: ensureContrast(c.palette.outline, input.shirtColor) },
        clipartSrc: clipart.url, wording: { ...base, ...(c.wording ?? {}) } };
      return { style, aiFallback: false, rationale: c.rationale };
    } catch (e) {
      user += `\n\nThe previous attempt failed: ${(e as Error).message}. Return only valid JSON matching the schema.`;
    }
  }
  return { style: fallbackStyle(input, clipart), aiFallback: true, rationale: "AI unavailable; used defaults." };
}
