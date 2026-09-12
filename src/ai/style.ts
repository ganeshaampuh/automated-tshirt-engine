import { z } from "zod";
import { CURATED_FONTS, DEFAULT_FONT, defaultWording, type SetInput, type SetStyle } from "@/engine";
import type { AIProvider } from "./provider";
import type { ClipartMeta } from "./clipart";
import { styleSystem, styleUser } from "./prompts";
import { accentColor, contrastRatio, derivePalette, distinct, ensureContrast, tint, FILL_MIN_CONTRAST, NUMERAL_TINT } from "./palette";

// Re-exported: these moved to `./palette` when the accent picking joined them, and every caller
// already reaches for them here.
export { contrastRatio, ensureContrast };

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
  rationale: z.string().default(""),
});

/**
 * The style a set gets with no model in the loop: the key is missing, or the call failed twice.
 */
export function fallbackStyle(input: SetInput, clipart: { url: string; meta: ClipartMeta }): SetStyle {
  return {
    template: "collage", font: DEFAULT_FONT,
    palette: derivePalette(clipart.meta.dominantColors, input.shirtColor),
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
        // The wording is the template's, never the model's: `collage` places these four slots at
        // fixed fractions of the block, so a phrase where it expects a word shrinks to `minSize`
        // and then runs into its neighbour. The model styles the set; it does not write it.
        clipartSrc: clipart.url, wording: base };
      return { style, aiFallback: false, rationale: c.rationale };
    } catch (e) {
      user += `\n\nThe previous attempt failed: ${(e as Error).message}. Return only valid JSON matching the schema.`;
    }
  }
  return { style: fallbackStyle(input, clipart), aiFallback: true, rationale: "AI unavailable; used defaults." };
}
