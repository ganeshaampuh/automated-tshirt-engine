import { describe, it, expect } from "vitest";
import { DesignSchema, SetInputSchema } from "@/engine/types";

describe("schemas", () => {
  it("rejects a design with unknown size class", () => {
    const r = DesignSchema.safeParse({ version: 2, sizeClass: "xl", canvas: { w: 1, h: 1, dpi: 300 }, shirtColor: "#fff", layers: [] });
    expect(r.success).toBe(false);
  });
  it("requires exactly one birthday-kid member", () => {
    const base = { kidName: "Keisya", age: 5, theme: "unicorn", shirtColor: "#ffffff", language: "id" };
    const none = SetInputSchema.safeParse({ ...base, members: [{ id: "m1", kind: "family", label: "Ayah", sizeClass: "adult" }] });
    const one = SetInputSchema.safeParse({ ...base, members: [{ id: "m1", kind: "birthday-kid", label: "Keisya", sizeClass: "kids-1-9" }] });
    expect(none.success).toBe(false);
    expect(one.success).toBe(true);
  });
});
