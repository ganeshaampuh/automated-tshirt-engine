import { describe, it, expect, vi } from "vitest";
import { chooseStyle, fallbackStyle, contrastRatio, ensureContrast } from "@/ai/style";
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
  it("appends the note on regenerate", async () => {
    const chat = vi.fn(async (_opts: { user: string }) => good);
    await chooseStyle(input, clipart, { provider: { generateImage: vi.fn(), chatJSON: chat as unknown as AIProvider["chatJSON"] } }, "lebih ceria");
    expect((chat.mock.calls[0][0] as { user: string }).user).toContain("lebih ceria");
  });
});
