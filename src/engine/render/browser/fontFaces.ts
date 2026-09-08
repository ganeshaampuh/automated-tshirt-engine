import { CURATED_FONTS, FONT_REGISTRY, fontUrl } from "../../fonts";

/** One `@font-face` per shipped face, at its exact weight — the browser must not synthesise bold. */
export function fontFaceCss(): string {
  return CURATED_FONTS.flatMap(f =>
    FONT_REGISTRY[f].faces.map(
      face => `@font-face { font-family: "${f}"; src: url("${fontUrl(f, face.weight)}") format("truetype"); font-weight: ${face.weight}; font-display: block; }`,
    ),
  ).join("\n");
}

export async function loadEngineFonts(): Promise<void> {
  if (typeof document === "undefined") return;
  await Promise.all(
    CURATED_FONTS.flatMap(f => FONT_REGISTRY[f].faces.map(face => document.fonts.load(`${face.weight} 32px "${f}"`))),
  );
}
