import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { CURATED_FONTS, FONT_REGISTRY } from "@/engine/fonts";
import { fontFilePath, registerFonts } from "@/engine/fonts.node";

describe("fonts", () => {
  it("lists six curated families", () => {
    expect(CURATED_FONTS).toEqual(["Fredoka", "Baloo 2", "Chewy", "Bangers", "Lilita One", "Luckiest Guy"]);
  });
  it("every face file exists", () => {
    for (const f of CURATED_FONTS)
      for (const face of FONT_REGISTRY[f].faces)
        expect(existsSync(fontFilePath(f, face.weight)), `${f} ${face.weight}`).toBe(true);
  });
  it("ships static instances, never a variable font", () => {
    for (const f of CURATED_FONTS)
      for (const face of FONT_REGISTRY[f].faces)
        expect(hasTable(fontFilePath(f, face.weight), "fvar"), `${f} ${face.weight}`).toBe(false);
  });
  it("registerFonts calls back once per face, under the family name", () => {
    const seen: [string, string][] = [];
    registerFonts((p, family) => seen.push([path.basename(p), family]));
    expect(seen).toEqual(
      CURATED_FONTS.flatMap(f => FONT_REGISTRY[f].faces.map(face => [face.file, f])),
    );
  });
});

/** True when the TrueType file has the named table — `fvar` marks a variable font. */
function hasTable(file: string, tag: string): boolean {
  const b = readFileSync(file);
  const n = b.readUInt16BE(4);
  for (let i = 0; i < n; i++) if (b.toString("ascii", 12 + i * 16, 16 + i * 16) === tag) return true;
  return false;
}
