import { CURATED_FONTS, FONT_REGISTRY, fontUrl } from "../../fonts";

export function fontFaceCss(): string {
  return CURATED_FONTS.map(f => {
    const w = FONT_REGISTRY[f].weights;
    const range = w.length > 1 ? `${Math.min(...w)} ${Math.max(...w)}` : String(w[0]);
    return `@font-face { font-family: "${f}"; src: url("${fontUrl(f)}") format("truetype"); font-weight: ${range}; font-display: block; }`;
  }).join("\n");
}

export async function loadEngineFonts(): Promise<void> {
  if (typeof document === "undefined") return;
  await Promise.all(CURATED_FONTS.flatMap(f => FONT_REGISTRY[f].weights.map(w => document.fonts.load(`${w} 32px "${f}"`))));
}
