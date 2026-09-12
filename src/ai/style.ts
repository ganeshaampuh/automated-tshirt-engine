import { z } from "zod";
import { CURATED_FONTS, DEFAULT_FONT, defaultWording, WordingSchema, type SetInput, type SetStyle } from "@/engine";
import type { AIProvider } from "./provider";
import type { ClipartMeta } from "./clipart";
import { styleSystem, styleUser } from "./prompts";

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const StyleChoice = z.object({
  font: z.enum(CURATED_FONTS as [string, ...string[]]),
  palette: z.object({ primary: Hex, secondary: Hex, outline: Hex }),
  wording: WordingSchema.partial().optional(),
  rationale: z.string().default(""),
});

const lum = (hex: string) => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const contrastRatio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const mix = (hex: string, t: number, toward: number) => "#" + [1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - t) + toward * t).toString(16).padStart(2, "0")).join("");
export function ensureContrast(color: string, against: string, min = 3): string {
  let c = color.toLowerCase();
  const toward = lum(against) > 0.5 ? 0 : 255;
  for (let i = 0; i < 20 && contrastRatio(c, against) < min; i++) c = mix(c, 0.1, toward);
  return c;
}

/**
 * The palette a clipart implies: its two most common colors, with the primary pushed away from the
 * shirt until it can be read on it. The defaults stand in when `dominantColors` found nothing —
 * a fully transparent or all-white image yields an empty list.
 *
 * This is the one definition of that rule; both the AI-unavailable path (`fallbackStyle`) and the
 * read-colors-on-upload path go through it, so the two cannot drift apart.
 */
export function paletteFromColors(colors: string[], shirtColor: string): SetStyle["palette"] {
  const [p = "#e6007e", s = "#f9a8d4"] = colors;
  const primary = ensureContrast(p, shirtColor);
  return { primary, secondary: s, outline: primary };
}

export function fallbackStyle(input: SetInput, clipart: { url: string; meta: ClipartMeta }): SetStyle {
  return {
    template: "collage", font: DEFAULT_FONT, palette: paletteFromColors(clipart.meta.dominantColors, input.shirtColor),
    clipartSrc: clipart.url, wording: defaultWording(input),
  };
}

export async function chooseStyle(input: SetInput, clipart: { url: string; meta: ClipartMeta }, deps: { provider: AIProvider }, note?: string) {
  const base = defaultWording(input);
  let user = styleUser(input, clipart.meta, note);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const c = await deps.provider.chatJSON({ system: styleSystem(CURATED_FONTS), user, schema: StyleChoice });
      const primary = ensureContrast(c.palette.primary, input.shirtColor);
      const style: SetStyle = { template: "collage", font: c.font, palette: { primary, secondary: c.palette.secondary, outline: ensureContrast(c.palette.outline, input.shirtColor) },
        clipartSrc: clipart.url, wording: { ...base, ...(c.wording ?? {}) } };
      return { style, aiFallback: false, rationale: c.rationale };
    } catch (e) {
      user += `\n\nThe previous attempt failed: ${(e as Error).message}. Return only valid JSON matching the schema.`;
    }
  }
  return { style: fallbackStyle(input, clipart), aiFallback: true, rationale: "AI unavailable; used defaults." };
}
