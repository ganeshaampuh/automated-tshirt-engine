import { describe, it, expect } from "vitest";
import { DesignSchema, SetInputSchema, SetStyleSchema } from "@/engine/types";

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
  it("accepts only an https url, a data: image or a shipped asset path as clipartSrc", () => {
    const style = (clipartSrc: string) => SetStyleSchema.safeParse({
      template: "collage", font: "Fredoka", palette: { primary: "#e6007e", secondary: "#f9a8d4", outline: "#e6007e" },
      clipartSrc, wording: { kidTop: "My", familyTop: "Keisya", ordinal: "th", occasion: "Birthday" },
    }).success;
    for (const ok of ["https://blob.example/a.png", "data:image/png;base64,AAAA", "tests/fixtures/unicorn.png", "public/samples/unicorn.png", "/samples/unicorn.png", "/mockups/white-adult.png", "/fonts/Fredoka.woff2"])
      expect(style(ok), ok).toBe(true);
    for (const bad of ["http://evil.test/a.png", "file:///etc/passwd", "/etc/passwd", "../../etc/passwd", "public/../../etc/passwd", "x", "", "data:text/html,<script>"])
      expect(style(bad), bad).toBe(false);
  });
});
