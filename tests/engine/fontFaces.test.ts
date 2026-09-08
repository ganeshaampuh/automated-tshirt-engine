import { describe, it, expect } from "vitest";
import { fontFaceCss } from "@/engine/render/browser/fontFaces";
import { CURATED_FONTS } from "@/engine";

describe("fontFaceCss", () => {
  it("declares every curated family with display: block", () => {
    const css = fontFaceCss();
    for (const f of CURATED_FONTS) expect(css).toContain(`font-family: "${f}"`);
    expect(css.match(/@font-face/g)?.length).toBe(CURATED_FONTS.length);
    expect(css).toContain("font-display: block");
    expect(css).toContain("/fonts/Fredoka.ttf");
  });
});
