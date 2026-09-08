import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MAX_CLIPART_PX, MAX_INPUT_PIXELS, MAX_UPLOAD_BYTES, MAX_UPLOAD_MESSAGE } from "@/lib/upload";
import { maxPx } from "@/engine";

const nextConfig = readFileSync(path.join(__dirname, "..", "..", "next.config.ts"), "utf8");

describe("clipart upload limits", () => {
  it("keeps an accepted upload under the Server Action body limit", () => {
    const limit = nextConfig.match(/bodySizeLimit: "(\d+)mb"/);
    expect(limit).not.toBeNull();
    expect(MAX_UPLOAD_BYTES).toBeLessThan(Number(limit![1]) * 1024 * 1024);
  });

  it("names the limit in the message the user sees", () => {
    expect(MAX_UPLOAD_MESSAGE).toContain(`${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
  });

  it("keeps a downscaled clipart big enough to fill the widest print canvas", () => {
    expect(MAX_CLIPART_PX).toBeGreaterThanOrEqual(maxPx("adult"));
  });

  it("still decodes a 50 MP phone photo", () => {
    expect(MAX_INPUT_PIXELS).toBeGreaterThan(50_000_000);
  });
});

describe("processClipartUpload", () => {
  it("downscales an oversized upload to the clipart cap and keeps its aspect ratio", async () => {
    const sharp = (await import("sharp")).default;
    const { processClipartUpload } = await import("@/lib/upload");
    const big = await sharp({
      create: { width: 8000, height: 6000, channels: 4, background: { r: 200, g: 30, b: 90, alpha: 1 } },
    })
      .png()
      .toBuffer();

    const out = await processClipartUpload(big);
    expect(out.width).toBe(MAX_CLIPART_PX);
    expect(out.height).toBe(Math.round((MAX_CLIPART_PX * 6000) / 8000));
    expect(out.png.length).toBeLessThan(big.length);
  });

  it("leaves a small clipart at its own size", async () => {
    const sharp = (await import("sharp")).default;
    const { processClipartUpload } = await import("@/lib/upload");
    const small = await sharp({
      create: { width: 300, height: 200, channels: 4, background: { r: 10, g: 10, b: 10, alpha: 1 } },
    })
      .png()
      .toBuffer();

    const out = await processClipartUpload(small);
    expect(out.width).toBe(300);
    expect(out.height).toBe(200);
  });
});
