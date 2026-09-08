import { describe, it, expect } from "vitest";
import { unzipSync } from "fflate";
import { exportSetZip } from "@/lib/sets";
import { createNodeMeasurer, loadImageFromFile } from "@/engine/server";
import { unicornSet, CLIPART_SIZE } from "../fixtures/set-unicorn";

describe("exportSetZip", () => {
  it("zips one print PNG and one mockup per member with cm sizes", async () => {
    const set = unicornSet();
    const { zip, sizes } = await exportSetZip(set, { measure: createNodeMeasurer(), clipartSize: CLIPART_SIZE, loadImage: loadImageFromFile });
    const files = unzipSync(new Uint8Array(zip));
    expect(Object.keys(files).sort()).toEqual(["Keisya-Ayah.mockup.jpg", "Keisya-Ayah.png", "Keisya-Keisya.mockup.jpg", "Keisya-Keisya.png", "Keisya-Kenzi.mockup.jpg", "Keisya-Kenzi.png", "Keisya-Mama.mockup.jpg", "Keisya-Mama.png"]);
    expect(sizes["ayah"].widthCm).toBeLessThanOrEqual(29);
    expect(sizes["kid"].widthCm).toBeLessThanOrEqual(20);
  }, 120_000);
});
