import { describe, it, expect } from "vitest";
import { PNG } from "pngjs";
import { exportPrintPng, ExportError } from "@/engine/exportPng";
import { loadImageFromFile } from "@/engine/render/server";
import { collage } from "@/engine/templates/collage";
import { createNodeMeasurer } from "@/engine/measure";
import { unicornSet, CLIPART_SIZE } from "../fixtures/set-unicorn";
import { maxCm } from "@/engine/sizing";

const ctx = { measure: createNodeMeasurer(), clipart: CLIPART_SIZE };

describe("exportPrintPng", () => {
  it("crops to bounding box + 1% margin and reports cm within the limit", async () => {
    const s = unicornSet();
    const d = collage(s, s.input.members[1], ctx); // kids-1-9
    const out = await exportPrintPng(d, loadImageFromFile);
    const png = PNG.sync.read(out.png);
    expect(png.width).toBeLessThan(d.canvas.w);
    expect(Math.max(out.widthCm, out.heightCm)).toBeLessThanOrEqual(maxCm("kids-1-9"));
    expect(png.data[3]).toBe(0); // transparent corner
  }, 30_000);

  it("refuses when a layer left the safe area", async () => {
    const s = unicornSet();
    const d = collage(s, s.input.members[0], ctx);
    d.layers[1] = { ...d.layers[1], x: -50 } as typeof d.layers[1];
    await expect(exportPrintPng(d, loadImageFromFile)).rejects.toBeInstanceOf(ExportError);
  });
});
