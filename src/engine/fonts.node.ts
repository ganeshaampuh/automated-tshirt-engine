import path from "node:path";
import { FONT_REGISTRY, CURATED_FONTS } from "./fonts";

export function fontFilePath(family: string): string {
  const entry = FONT_REGISTRY[family];
  if (!entry) throw new Error(`Unknown font family: ${family}`);
  return path.join(process.cwd(), "public", "fonts", entry.file);
}

export function registerFonts(register: (filePath: string, family: string) => void): void {
  for (const family of CURATED_FONTS) register(fontFilePath(family), family);
}
