import { describe, it, expect } from "vitest";
import { ENGINE_VERSION } from "@/engine";
import * as engine from "@/engine";

describe("engine", () => {
  it("exports a version", () => {
    expect(ENGINE_VERSION).toBe(2);
  });

  it("exposes the public surface", () => {
    for (const name of ["DesignSchema", "SetSchema", "maxCm", "canvasFor", "boundingBoxCm", "isWithinSafeArea",
      "CURATED_FONTS", "createNodeMeasurer", "fitText", "defaultWording", "collage", "expand", "applyOverrides",
      "renderDesign", "loadImageFromFile", "exportPrintPng", "ExportError", "renderMockup", "loadShirtAsset", "defaultShirtFor"]) {
      expect(engine, name).toHaveProperty(name);
    }
  });
});
