import { describe, it, expect, vi } from "vitest";
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { generateClipart, describeClipart, dominantColors } from "@/ai/clipart";
import type { AIProvider } from "@/ai/provider";

const unicorn = readFileSync("tests/fixtures/unicorn.png");

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

  it("keeps the white inside the drawing, not only around it", async () => {
    // CogView draws on a plain white background, and the drawing itself has white in it. The
    // background must go; the gleam in the eye must not.
    let uploaded: Buffer | undefined;
    const provider: AIProvider = {
      chatJSON: vi.fn(),
      generateImage: vi.fn(async () =>
        sharp({ create: { width: 300, height: 300, channels: 4, background: "#ffffff" } })
          .composite([
            { input: await sharp({ create: { width: 120, height: 120, channels: 4, background: "#000000" } }).png().toBuffer(), left: 90, top: 90 },
            { input: await sharp({ create: { width: 24, height: 24, channels: 4, background: "#ffffff" } }).png().toBuffer(), left: 138, top: 138 },
          ])
          .png()
          .toBuffer(),
      ),
    };
    const putBlob = vi.fn(async (_path: string, body: Buffer) => { uploaded = body; return "https://blob/clipart.png"; });

    await generateClipart("unicorn", { provider, putBlob });

    const { data, info } = await sharp(uploaded!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const middle = ((info.height >> 1) * info.width + (info.width >> 1)) * 4;
    expect(data[middle + 3]).toBe(255);
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
