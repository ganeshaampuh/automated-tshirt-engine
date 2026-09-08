export const FONT_REGISTRY: Record<string, { file: string; weights: number[] }> = {
  "Fredoka":      { file: "Fredoka.ttf",     weights: [400, 700] },
  "Baloo 2":      { file: "Baloo2.ttf",      weights: [400, 700, 900] },
  "Chewy":        { file: "Chewy.ttf",       weights: [400] },
  "Bangers":      { file: "Bangers.ttf",     weights: [400] },
  "Lilita One":   { file: "LilitaOne.ttf",   weights: [400] },
  "Luckiest Guy": { file: "LuckiestGuy.ttf", weights: [400] },
};

export const CURATED_FONTS = Object.keys(FONT_REGISTRY);
export const DEFAULT_FONT = "Fredoka";

/** URL path the browser loads a font from (served from public/). */
export const fontUrl = (family: string) => {
  const e = FONT_REGISTRY[family];
  if (!e) throw new Error(`Unknown font family: ${family}`);
  return `/fonts/${e.file}`;
};
