import { describe, it, expect, vi, beforeEach } from "vitest";
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { generateClipart, describeClipart, removeWhiteBackground, dominantColors, clearDescribeCacheForTests } from "@/ai/clipart";
import type { AIProvider } from "@/ai/provider";
import * as sets from "@/lib/sets";

const unicorn = readFileSync("tests/fixtures/unicorn.png");

describe("removeWhiteBackground", () => {
  it("turns a white border transparent and trims", async () => {
    const src = await sharp({ create: { width: 200, height: 200, channels: 4, background: "#ffffff" } })
      .composite([{ input: await sharp({ create: { width: 50, height: 80, channels: 4, background: "#ff0000" } }).png().toBuffer(), left: 75, top: 60 }]).png().toBuffer();
    const out = await removeWhiteBackground(src);
    const meta = await sharp(out).metadata();
    expect(meta.width).toBeLessThanOrEqual(52); expect(meta.height).toBeLessThanOrEqual(82);
    const { data } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    expect(data[3]).toBe(255); // top-left after trim is red, opaque
  });
});

describe("dominantColors", () => {
  it("finds pinks in the unicorn fixture and ignores white/transparent", async () => {
    const cols = await dominantColors(unicorn, 5);
    expect(cols.length).toBeGreaterThan(0);
    for (const c of cols) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    expect(cols).not.toContain("#ffffff");
  });
});

describe("generateClipart", () => {
  it("augments the prompt, post-processes, uploads, returns url + size", async () => {
    const provider: AIProvider = {
      chatJSON: vi.fn(),
      generateImage: vi.fn(async ({ prompt }) => {
        expect(prompt).toContain("unicorn"); expect(prompt).toMatch(/plain white background/i); expect(prompt).toMatch(/no text/i);
        return sharp({ create: { width: 300, height: 300, channels: 4, background: "#ffffff" } })
          .composite([{ input: await sharp({ create: { width: 100, height: 60, channels: 4, background: "#00ff00" } }).png().toBuffer(), left: 100, top: 120 }]).png().toBuffer();
      }),
    };
    const putBlob = vi.fn(async (path: string) => { expect(path).toMatch(/^clipart\/.*\.png$/); return "https://blob/clipart.png"; });
    const out = await generateClipart("unicorn", { provider, putBlob });
    expect(out.url).toBe("https://blob/clipart.png");
    expect(out.width).toBeLessThanOrEqual(102); expect(out.height).toBeLessThanOrEqual(62);
  });
});

describe("describeClipart", () => {
  it("combines local metrics with the vision model", async () => {
    const provider: AIProvider = {
      generateImage: vi.fn(),
      chatJSON: vi.fn(async ({ images }) => { expect(images?.[0]).toMatch(/^data:image\/png;base64,/); return { caption: "a cute unicorn on a cloud", kind: "illustration" }; }) as unknown as AIProvider["chatJSON"],
    };
    const meta = await describeClipart(unicorn, { provider });
    expect(meta).toMatchObject({ width: 1000, height: 800, kind: "illustration" });
    expect(meta.dominantColors.length).toBeGreaterThan(0);
  });
  it("falls back to kind=illustration and an empty caption when the vision call fails", async () => {
    const provider: AIProvider = { generateImage: vi.fn(), chatJSON: vi.fn(async () => { throw new Error("down"); }) };
    const meta = await describeClipart(unicorn, { provider });
    expect(meta.kind).toBe("illustration"); expect(meta.caption).toBe("");
  });
});

describe("describeClipart caching", () => {
  beforeEach(() => { clearDescribeCacheForTests(); vi.restoreAllMocks(); });

  /** A provider that captions, plus a stubbed fetch so no request leaves the test. */
  const spy = (caption = "a cute unicorn") => {
    const chatJSON = vi.fn(async () => ({ caption, kind: "illustration" }));
    vi.spyOn(sets, "fetchBytes").mockResolvedValue(unicorn);
    return { provider: { generateImage: vi.fn(), chatJSON } as unknown as AIProvider, chatJSON };
  };

  it("describes a blob url once, however many times the style is regenerated", async () => {
    const { provider, chatJSON } = spy();
    const a = await describeClipart("https://blob/clipart-1.png", { provider });
    const b = await describeClipart("https://blob/clipart-1.png", { provider });
    expect(chatJSON).toHaveBeenCalledTimes(1);
    expect(b).toEqual(a);
  });

  it("describes a different clipart separately", async () => {
    const { provider, chatJSON } = spy();
    await describeClipart("https://blob/clipart-1.png", { provider });
    await describeClipart("https://blob/clipart-2.png", { provider });
    expect(chatJSON).toHaveBeenCalledTimes(2);
  });

  it("collapses two presses that race into one description", async () => {
    const { provider, chatJSON } = spy();
    await Promise.all([
      describeClipart("https://blob/clipart-1.png", { provider }),
      describeClipart("https://blob/clipart-1.png", { provider }),
    ]);
    expect(chatJSON).toHaveBeenCalledTimes(1);
  });

  it("does not pin a caption the vision model failed to produce", async () => {
    vi.spyOn(sets, "fetchBytes").mockResolvedValue(unicorn);
    const chatJSON = vi.fn()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce({ caption: "a cute unicorn", kind: "illustration" });
    const provider = { generateImage: vi.fn(), chatJSON } as unknown as AIProvider;
    expect((await describeClipart("https://blob/clipart-1.png", { provider })).caption).toBe("");
    expect((await describeClipart("https://blob/clipart-1.png", { provider })).caption).toBe("a cute unicorn");
    expect(chatJSON).toHaveBeenCalledTimes(2);
  });

  it("never keys on a data: src — the payload would be its own key", async () => {
    const { provider, chatJSON } = spy();
    const src = `data:image/png;base64,${unicorn.toString("base64")}`;
    await describeClipart(src, { provider });
    await describeClipart(src, { provider });
    expect(chatJSON).toHaveBeenCalledTimes(2);
  });
});
