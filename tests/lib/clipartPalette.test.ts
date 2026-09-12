import { describe, it, expect } from "vitest";
import { styleWithPalette } from "@/lib/clipartPalette";
import { paletteFromClipart } from "@/ai/style";
import { DEFAULT_FONT, defaultWording, type SetInput, type SetStyle } from "@/engine";

const input = (shirtColor = "#ffffff"): SetInput => ({
  kidName: "Keisya", age: 5, theme: "unicorn", shirtColor, language: "id",
  members: [{ id: "kid", kind: "birthday-kid", label: "Keisya", sizeClass: "kids-1-9" }],
});

const tuned: SetStyle = {
  template: "collage", font: "Bangers",
  palette: { primary: "#111111", secondary: "#222222", outline: "#333333" },
  clipartSrc: "/old-clipart.png",
  wording: { kidTop: "Selamat", familyTop: "Keisya", ordinal: "ke-5", occasion: "Pesta" },
};

describe("styleWithPalette", () => {
  it("moves only the palette and the clipart on a style the shop has tuned", () => {
    // A shop mid-order has already chosen a font and reworded the shirt; re-uploading the clipart
    // is not a request to throw that away.
    const next = styleWithPalette(tuned, input(), "/new-clipart.png", ["#ff0000", "#00ff00"]);
    expect(next.font).toBe(tuned.font);
    expect(next.wording).toEqual(tuned.wording);
    expect(next.template).toBe(tuned.template);
    expect(next.clipartSrc).toBe("/new-clipart.png");
    expect(next.palette).not.toEqual(tuned.palette);
  });

  it("builds a complete, printable style for a set that has none yet", () => {
    const i = input();
    const next = styleWithPalette(null, i, "/new-clipart.png", ["#ff0000", "#00ff00"]);
    expect(next).toEqual({
      template: "collage",
      font: DEFAULT_FONT,
      palette: paletteFromClipart(["#ff0000", "#00ff00"], i.shirtColor),
      clipartSrc: "/new-clipart.png",
      wording: defaultWording(i),
    });
  });

  it("derives the palette through the one shared rule, so upload and AI-fallback cannot drift", () => {
    const i = input();
    const colors = ["#ff0000", "#00ff00"];
    expect(styleWithPalette(null, i, "/c.png", colors).palette).toEqual(paletteFromClipart(colors, i.shirtColor));
    expect(styleWithPalette(tuned, i, "/c.png", colors).palette).toEqual(paletteFromClipart(colors, i.shirtColor));
  });

  it("pushes a primary that would be unreadable away from the shirt", () => {
    // A near-white clipart on a white shirt is the case the shop cannot see on screen until it prints.
    const next = styleWithPalette(null, input("#ffffff"), "/c.png", ["#fdfdfd", "#f9a8d4"]);
    expect(next.palette.primary).not.toBe("#fdfdfd");
  });

  it("keeps the wording built for the set's own language and age", () => {
    const i: SetInput = { ...input(), language: "en", age: 3 };
    expect(styleWithPalette(null, i, "/c.png", []).wording).toEqual(defaultWording(i));
  });

  it("stands up a palette even when the clipart yielded no colours", () => {
    // A fully transparent or all-white upload reads as an empty list; the set still has to print.
    const next = styleWithPalette(null, input(), "/c.png", []);
    expect(next.palette.primary).toMatch(/^#[0-9a-f]{6}$/i);
    expect(next.palette.secondary).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
