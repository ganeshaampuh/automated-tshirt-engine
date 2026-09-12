import { DEFAULT_FONT, defaultWording, type SetInput, type SetStyle } from "@/engine";
import { derivePalette } from "@/ai/palette";

/**
 * The style a set should have once a freshly uploaded clipart has been read for its colors.
 *
 * Pure: the caller reads the bytes and supplies the colors. Two cases, and the difference matters to
 * a shop mid-order — a style it has already tuned keeps its font and its wording, and only the
 * palette and the clipart move. A set with no style yet gets a complete one built without the AI,
 * the same shape `fallbackStyle` produces, so the upload leaves behind something printable rather
 * than a half-filled record; "Buat gaya" still refines it afterwards.
 */
export function styleWithPalette(
  existing: SetStyle | null,
  input: SetInput,
  clipartUrl: string,
  colors: string[],
): SetStyle {
  const palette = derivePalette(colors, input.shirtColor);
  if (existing) return { ...existing, palette, clipartSrc: clipartUrl };
  return { template: "collage", font: DEFAULT_FONT, palette, clipartSrc: clipartUrl, wording: defaultWording(input) };
}
