import { describe, it, expect } from "vitest";
import { setFonts } from "@/engine/setFonts";
import { CURATED_FONTS, DEFAULT_FONT } from "@/engine/fonts";
import type { Member, SetInput, SetStyle } from "@/engine/types";

const member = (id: string, overrides?: Member["overrides"]): Member =>
  ({ id, kind: "family", label: id, sizeClass: "adult", ...(overrides ? { overrides } : {}) });

const input = (members: Member[]): SetInput => ({
  kidName: "Keisya", age: 5, theme: "unicorn", shirtColor: "#ffffff", language: "id",
  members: [{ id: "kid", kind: "birthday-kid", label: "Keisya", sizeClass: "kids-1-9" }, ...members],
});

const style = (font: string): SetStyle => ({
  template: "collage", font,
  palette: { primary: "#e6007e", secondary: "#f9a8d4", outline: "#e6007e" },
  clipartSrc: "/samples/unicorn.png",
  wording: { kidTop: "Ulang Tahunku", familyTop: "Keisya", ordinal: "ke-5", occasion: "Ulang Tahun" },
});

describe("setFonts", () => {
  it("names the set's own font", () => {
    expect(setFonts(input([]), style("Chewy"))).toEqual(["Chewy"]);
  });

  it("falls back to the default font for a set with no style yet", () => {
    // A set is browsable before "Buat gaya" has ever run, and the page still has to draw text.
    expect(setFonts(input([]), null)).toEqual([DEFAULT_FONT]);
  });

  it("includes a font a member's override introduces", () => {
    const fonts = setFonts(input([member("ayah", { title: { font: "Bangers" } })]), style("Chewy"));
    expect(new Set(fonts)).toEqual(new Set(["Chewy", "Bangers"]));
  });

  it("names each family once, however many members ask for it", () => {
    const members = [
      member("ayah", { title: { font: "Bangers" } }),
      member("mama", { title: { font: "Bangers" }, name: { font: "Chewy" } }),
    ];
    const fonts = setFonts(input(members), style("Chewy"));
    expect(fonts).toHaveLength(new Set(fonts).size);
    expect(new Set(fonts)).toEqual(new Set(["Chewy", "Bangers"]));
  });

  it("drops an override naming a family that is not curated", () => {
    // `overrides` is unknown by the schema's own admission, so this reaches here from stored data.
    // There is no face to fetch, and applyOverrides would refuse it downstream anyway.
    const fonts = setFonts(input([member("ayah", { title: { font: "Comic Sans MS" } })]), style("Chewy"));
    expect(fonts).toEqual(["Chewy"]);
  });

  it("ignores an override whose font is not a string", () => {
    const members = [member("ayah", { title: { font: 42 } }), member("mama", { title: { size: 120 } })];
    expect(setFonts(input(members), style("Chewy"))).toEqual(["Chewy"]);
  });

  it("only ever returns families the browser can actually fetch faces for", () => {
    const members = [member("ayah", { title: { font: "Bangers" } }), member("mama", { title: { font: "Nope" } })];
    for (const f of setFonts(input(members), style("Lilita One"))) expect(CURATED_FONTS).toContain(f);
  });
});
