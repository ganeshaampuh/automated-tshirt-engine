import { describe, it, expect } from "vitest";
import { ENGINE_VERSION } from "@/engine";
import * as engine from "@/engine";
import * as server from "@/engine/server";

describe("engine", () => {
  it("exports a version", () => {
    expect(ENGINE_VERSION).toBe(2);
  });

  it("exposes the isomorphic surface", () => {
    for (const name of ["DesignSchema", "SetSchema", "maxCm", "canvasFor", "boundingBoxCm", "isWithinSafeArea",
      "CURATED_FONTS", "DEFAULT_FONT", "fontUrl", "fontWeights", "nearestWeight", "displayText", "fitText", "defaultWording", "ordinalSuffix",
      "resolveLines", "collage", "expand", "applyOverrides", "setFonts"]) {
      expect(engine, name).toHaveProperty(name);
    }
  });

  it("keeps server-only names out of the isomorphic barrel", () => {
    for (const name of ["createNodeMeasurer", "renderDesign", "loadImageFromFile", "exportPrintPng",
      "renderMockup", "loadShirtAsset", "fontFilePath", "registerFonts"]) {
      expect(engine, name).not.toHaveProperty(name);
    }
  });

  it("exposes the server surface", () => {
    for (const name of ["createNodeMeasurer", "ensureNodeFonts", "renderDesign", "loadImageFromFile",
      "exportPrintPng", "ExportError", "renderMockup", "loadShirtAsset", "defaultShirtFor",
      "ShirtAssetSchema", "fontFilePath", "registerFonts"]) {
      expect(server, name).toHaveProperty(name);
    }
  });
});
