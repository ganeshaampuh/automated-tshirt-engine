import { describe, it, expect, vi } from "vitest";
import { chooseStyle, fallbackStyle, contrastRatio, ensureContrast } from "@/ai/style";
import { distinct, HOUSE_ACCENT, tint, toHsl } from "@/ai/palette";
import { unicornSet } from "../fixtures/set-unicorn";
import type { AIProvider } from "@/ai/provider";
import { AIError } from "@/ai/provider";

const input = unicornSet().input;
const clipart = { url: "https://blob/u.png", meta: { width: 1000, height: 800, dominantColors: ["#e6007e", "#f9a8d4", "#fde68a"], caption: "unicorn", kind: "illustration" as const } };
const good = { font: "Bangers", palette: { primary: "#e6007e", secondary: "#f9a8d4", outline: "#e6007e" }, rationale: "playful" };

describe("contrast helpers", () => {
  it("computes WCAG ratio", () => { expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0); });
  it("darkens a pale color on white until readable", () => {
    const c = ensureContrast("#f9a8d4", "#ffffff", 3);
    expect(contrastRatio(c, "#ffffff")).toBeGreaterThanOrEqual(3);
  });
});

describe("chooseStyle", () => {
  it("returns validated style from the model", async () => {
    const provider: AIProvider = { generateImage: vi.fn(), chatJSON: vi.fn(async () => good) as unknown as AIProvider["chatJSON"] };
    const r = await chooseStyle(input, clipart, { provider });
    expect(r.aiFallback).toBe(false); expect(r.style.font).toBe("Bangers"); expect(r.style.template).toBe("collage");
    expect(r.style.clipartSrc).toBe(clipart.url); expect(r.style.wording.occasion).toBe("Birthday");
  });
  it("retries once with the error, then falls back", async () => {
    const chat = vi.fn().mockRejectedValueOnce(new AIError("bad", "{}")).mockRejectedValueOnce(new AIError("bad again"));
    const provider: AIProvider = { generateImage: vi.fn(), chatJSON: chat };
    const r = await chooseStyle(input, clipart, { provider });
    expect(chat).toHaveBeenCalledTimes(2);
    expect((chat.mock.calls[1][0] as { user: string }).user).toMatch(/previous attempt failed/i);
    expect(r.aiFallback).toBe(true); expect(r.style.font).toBe("Fredoka"); expect(r.style.palette.primary).toMatch(/^#/);
  });
  it("rejects an uncurated font via schema and falls back", async () => {
    const provider: AIProvider = { generateImage: vi.fn(), chatJSON: vi.fn(async ({ schema }) => schema.parse({ ...good, font: "Comic Sans" })) };
    const r = await chooseStyle(input, clipart, { provider });
    expect(r.aiFallback).toBe(true);
  });
  it("enforces contrast against the shirt color", async () => {
    const provider: AIProvider = { generateImage: vi.fn(), chatJSON: vi.fn(async () => ({ ...good, palette: { primary: "#fefefe", secondary: "#f9a8d4", outline: "#fdfdfd" } })) as unknown as AIProvider["chatJSON"] };
    const r = await chooseStyle({ ...input, shirtColor: "#ffffff" }, clipart, { provider });
    expect(contrastRatio(r.style.palette.primary, "#ffffff")).toBeGreaterThanOrEqual(3);
  });
  /**
   * The numeral is the biggest thing on the shirt and the model is free to colour it, but not free
   * to make it disappear: a fill the same darkness as its own stroke reads as a blob, and one with
   * no contrast against the shirt reads as nothing at all.
   */
  it("replaces a numeral fill the model chose too close to its own stroke", async () => {
    const provider: AIProvider = { generateImage: vi.fn(), chatJSON: vi.fn(async () => ({ ...good, palette: { primary: "#222222", secondary: "#111111", outline: "#222222" } })) as unknown as AIProvider["chatJSON"] };
    const r = await chooseStyle({ ...input, shirtColor: "#ffffff" }, clipart, { provider });
    expect(r.aiFallback).toBe(false);
    expect(distinct(r.style.palette.secondary, r.style.palette.primary)).toBe(true);
  });

  it("replaces a numeral fill that would vanish into the shirt", async () => {
    const provider: AIProvider = { generateImage: vi.fn(), chatJSON: vi.fn(async () => ({ ...good, palette: { primary: "#e6007e", secondary: "#000000", outline: "#e6007e" } })) as unknown as AIProvider["chatJSON"] };
    const r = await chooseStyle({ ...input, shirtColor: "#000000" }, clipart, { provider });
    expect(contrastRatio(r.style.palette.secondary, "#000000")).toBeGreaterThanOrEqual(1.6);
  });

  // A model that pairs the bow's red with the crown's amber knows something about the artwork that
  // arithmetic does not, and a pair that clears both guards is left exactly as it chose it.
  it("leaves a workable pair of the model's own choosing alone", async () => {
    const provider: AIProvider = { generateImage: vi.fn(), chatJSON: vi.fn(async () => ({ ...good, palette: { primary: "#e6007e", secondary: "#fbbf24", outline: "#e6007e" } })) as unknown as AIProvider["chatJSON"] };
    const r = await chooseStyle({ ...input, shirtColor: "#ffffff" }, clipart, { provider });
    expect(r.style.palette.secondary).toBe("#fbbf24");
  });

  it("tells the model which colour is the artwork's accent, not just which is commonest", async () => {
    const chat = vi.fn(async (_opts: { user: string }) => good);
    const kitty = { ...clipart, meta: { ...clipart.meta, dominantColors: ["#222222", "#111111", "#ff4444"] } };
    await chooseStyle(input, kitty, { provider: { generateImage: vi.fn(), chatJSON: chat as unknown as AIProvider["chatJSON"] } });
    const { user } = chat.mock.calls[0][0] as { user: string };
    const named = /accent color: (#[0-9a-f]{6})/i.exec(user);
    expect(named, user).not.toBeNull();
    // The red bow, rebuilt for print — never one of the two blacks that merely cover more area.
    expect(toHsl(named![1]).s).toBeGreaterThanOrEqual(0.5);
  });

  it("appends the note on regenerate", async () => {
    const chat = vi.fn(async (_opts: { user: string }) => good);
    await chooseStyle(input, clipart, { provider: { generateImage: vi.fn(), chatJSON: chat as unknown as AIProvider["chatJSON"] } }, "lebih ceria");
    expect((chat.mock.calls[0][0] as { user: string }).user).toContain("lebih ceria");
  });
});

/**
 * The no-AI path, which is what every set gets when the key is missing or the model is down. It has
 * to produce a shirt worth printing on its own, not merely a shirt that renders.
 */
describe("fallbackStyle", () => {
  const kitty = (shirt: string) => fallbackStyle({ ...input, shirtColor: shirt },
    { url: "u", meta: { width: 1, height: 1, dominantColors: ["#222222", "#111111", "#ff4444"], caption: "", kind: "illustration" as const } });

  it("takes the artwork's accent rather than its outline ink", () => {
    const p = kitty("#ffffff").palette;
    expect(toHsl(p.primary).s).toBeGreaterThanOrEqual(0.5);
  });

  it("builds the numeral fill from the primary, so the two always read as a pair", () => {
    const p = kitty("#ffffff").palette;
    expect(p.secondary).toBe(tint(p.primary, 0.55));
    expect(distinct(p.secondary, p.primary)).toBe(true);
  });

  it("keeps the numeral fill visible on a dark shirt", () => {
    expect(contrastRatio(kitty("#000000").palette.secondary, "#000000")).toBeGreaterThanOrEqual(1.6);
  });

  it("falls back to the house colour when the clipart has no colour in it", () => {
    const s2 = fallbackStyle(input, { url: "u", meta: { width: 1, height: 1, dominantColors: ["#222222", "#111111"], caption: "", kind: "illustration" as const } });
    expect(s2.palette.primary).toBe(HOUSE_ACCENT);
  });
});
