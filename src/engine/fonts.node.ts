import path from "node:path";
import { FONT_REGISTRY, CURATED_FONTS, fontFace } from "./fonts";

/** Absolute path of the face a family/weight pair resolves to. */
export function fontFilePath(family: string, weight: number = 400): string {
  return path.join(process.cwd(), "public", "fonts", fontFace(family, weight).file);
}

/**
 * Call `register` once per **face**, always with the family name. `GlobalFonts.registerFromPath`
 * takes several files under one family and picks between them by the `font` string's weight, so a
 * bold layer draws the bold file instead of a synthesised or default face.
 */
export function registerFonts(register: (filePath: string, family: string) => void): void {
  for (const family of CURATED_FONTS) {
    for (const face of FONT_REGISTRY[family].faces) {
      register(path.join(process.cwd(), "public", "fonts", face.file), family);
    }
  }
}
