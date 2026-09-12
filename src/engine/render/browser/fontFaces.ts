import { CURATED_FONTS, FONT_REGISTRY, fontUrl } from "../../fonts";

/**
 * One `@font-face` per shipped face, at its exact weight — the browser must not synthesise bold.
 *
 * Every family is declared, and that costs nothing: a `@font-face` rule is a promise, not a
 * download. The browser fetches a file only when something asks to draw with it — the font picker
 * previewing a family name, or `loadEngineFonts` asking for a face outright.
 */
export function fontFaceCss(): string {
  return CURATED_FONTS.flatMap(f =>
    FONT_REGISTRY[f].faces.map(
      face => `@font-face { font-family: "${f}"; src: url("${fontUrl(f, face.weight)}") format("truetype"); font-weight: ${face.weight}; font-display: block; }`,
    ),
  ).join("\n");
}

/**
 * The CSS font shorthands naming every face these families ship.
 *
 * A family the registry does not know is dropped rather than thrown on: the caller's list comes
 * from stored documents, and a set saved against a font that has since been retired must still
 * open.
 */
export function fontSpecs(families: string[]): string[] {
  return families.flatMap(f => (FONT_REGISTRY[f]?.faces ?? []).map(face => `${face.weight} 32px "${f}"`));
}

/**
 * Fetches the faces these families ship, and nothing else.
 *
 * The size is the shorthand's, not the design's — `document.fonts.load` resolves a face, and a face
 * is one file whatever size it is later drawn at.
 */
export async function loadEngineFonts(families: string[]): Promise<void> {
  if (typeof document === "undefined") return;
  await Promise.all(fontSpecs(families).map(spec => document.fonts.load(spec)));
}
