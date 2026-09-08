import { describe, it, expect } from "vitest";
import { ENGINE_VERSION } from "@/engine";

describe("engine", () => {
  it("exports a version", () => {
    expect(ENGINE_VERSION).toBe(2);
  });
});
