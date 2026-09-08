import path from "node:path";

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

export function fontFilePath(family: string): string {
  const entry = FONT_REGISTRY[family];
  if (!entry) throw new Error(`Unknown font family: ${family}`);
  return path.join(process.cwd(), "public", "fonts", entry.file);
}

export function registerFonts(register: (filePath: string, family: string) => void): void {
  for (const family of CURATED_FONTS) register(fontFilePath(family), family);
}
