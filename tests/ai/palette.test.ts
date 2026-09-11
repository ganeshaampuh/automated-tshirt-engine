import { describe, it, expect } from "vitest";
import { accentColor, derivePalette, distinct, HOUSE_ACCENT, tint, toHsl } from "@/ai/palette";
import { contrastRatio } from "@/ai/style";

/** The real output of `dominantColors` on the two cliparts this repo ships. */
const HELLO_KITTY = ["#222222", "#111111", "#ff4444", "#221111", "#ee3344"];
const UNICORN = ["#ffcccc", "#ff99aa", "#ffddcc", "#775577", "#664466"];

/**
 * `dominantColors` ranks by area, and area is a poor guide to what a drawing is *about*: a cartoon
 * is mostly its own outline ink. The accent is the colour a person would name if asked what colour
 * the picture is — and it has to come back printable, not as the pale wash a pastel actually is.
 */
describe("accentColor", () => {
  it("skips the outline ink and takes the artwork's real colour", () => {
    // Hello Kitty is black line work by area; the bow is the only colour in her.
    const a = accentColor(HELLO_KITTY);
    expect(toHsl(a).s).toBeGreaterThanOrEqual(0.75);
    // Red bow, red accent: within a few degrees of #ff4444's hue.
    expect(Math.abs(toHsl(a).h - toHsl("#ff4444").h)).toBeLessThan(10);
  });

  it("keeps a pastel's hue but gives it back its punch", () => {
    const a = accentColor(UNICORN);
    expect(Math.abs(toHsl(a).h - toHsl("#ff99aa").h)).toBeLessThan(10);
    expect(toHsl(a).s).toBeGreaterThanOrEqual(0.75);
    // The pastel's own lightness is 0.80, which is what made it wash out.
    expect(toHsl(a).l).toBeLessThanOrEqual(0.55);
    expect(toHsl(a).l).toBeGreaterThanOrEqual(0.35);
  });

  it("is far more readable on a white shirt than the raw pastel was", () => {
    expect(contrastRatio(accentColor(UNICORN), "#ffffff")).toBeGreaterThan(contrastRatio("#ff99aa", "#ffffff"));
  });

  it("falls back to the house colour for line art with no colour in it", () => {
    expect(accentColor(["#222222", "#111111", "#333333", "#eeeeee"])).toBe(HOUSE_ACCENT);
  });

  it("falls back to the house colour when there is nothing to read at all", () => {
    expect(accentColor([])).toBe(HOUSE_ACCENT);
  });
});

describe("tint", () => {
  it("mixes toward white by the amount given", () => {
    expect(tint("#e6007e", 0.5)).toBe("#f380bf");
  });

  it("leaves the colour alone at zero and reaches white at one", () => {
    expect(tint("#e6007e", 0)).toBe("#e6007e");
    expect(tint("#e6007e", 1)).toBe("#ffffff");
  });
});

/**
 * The guard on the numeral: its fill and its stroke are drawn one inside the other, so two colours
 * that merely differ in hex are not enough — they have to differ in *light*, or the numeral reads
 * as one solid blob.
 */
describe("distinct", () => {
  it("refuses two near-identical darks", () => {
    expect(distinct("#222222", "#111111")).toBe(false);
  });

  it("accepts a colour against a tint of itself", () => {
    expect(distinct("#e6007e", tint("#e6007e", 0.55))).toBe(true);
  });
});

/**
 * The whole palette from a clipart's colours — one definition, shared by the no-AI style and by the
 * upload that now recolours a set the moment its artwork changes.
 */
describe("derivePalette", () => {
  it("builds the three inks around the artwork's accent", () => {
    const p = derivePalette(HELLO_KITTY, "#ffffff");
    expect(p.outline).toBe(p.primary);
    expect(p.secondary).toBe(tint(p.primary, 0.55));
    expect(toHsl(p.primary).s).toBeGreaterThanOrEqual(0.5);
  });

  it("keeps the numeral fill visible on a dark shirt", () => {
    expect(contrastRatio(derivePalette(HELLO_KITTY, "#000000").secondary, "#000000")).toBeGreaterThanOrEqual(1.6);
  });

  it("keeps the text readable on a shirt its own colour", () => {
    // A red clipart on a red shirt: the accent cannot be used as found.
    expect(contrastRatio(derivePalette(["#ff4444"], "#ff4444").primary, "#ff4444")).toBeGreaterThanOrEqual(3);
  });

  it("falls back to the house colour for line art", () => {
    expect(derivePalette(["#222222", "#111111"], "#ffffff").primary).toBe(HOUSE_ACCENT);
  });
});
