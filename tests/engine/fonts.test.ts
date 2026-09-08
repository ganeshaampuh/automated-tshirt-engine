import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { CURATED_FONTS, fontFilePath, registerFonts } from "@/engine/fonts";

describe("fonts", () => {
  it("lists six curated families", () => {
    expect(CURATED_FONTS).toEqual(["Fredoka", "Baloo 2", "Chewy", "Bangers", "Lilita One", "Luckiest Guy"]);
  });
  it("every font file exists", () => {
    for (const f of CURATED_FONTS) expect(existsSync(fontFilePath(f)), f).toBe(true);
  });
  it("registerFonts calls back for each family", () => {
    const seen: string[] = [];
    registerFonts((_path, family) => seen.push(family));
    expect(seen).toEqual(CURATED_FONTS);
  });
});
