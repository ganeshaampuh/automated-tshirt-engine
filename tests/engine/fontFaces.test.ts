import { describe, it, expect } from "vitest";
import { fontFaceCss } from "@/engine/render/browser/fontFaces";
import { CURATED_FONTS, FONT_REGISTRY } from "@/engine";

describe("fontFaceCss", () => {
  it("declares every curated family with display: block", () => {
    const css = fontFaceCss();
    for (const f of CURATED_FONTS) expect(css).toContain(`font-family: "${f}"`);
    const faces = CURATED_FONTS.flatMap(f => FONT_REGISTRY[f].faces);
    expect(css.match(/@font-face/g)?.length).toBe(faces.length);
    expect(css).toContain("font-display: block");
    // One rule per static face, at its exact weight — no synthesised bold, no weight range.
    expect(css).toContain(`url("/fonts/Fredoka-Regular.ttf") format("truetype"); font-weight: 400`);
    expect(css).toContain(`url("/fonts/Fredoka-Bold.ttf") format("truetype"); font-weight: 700`);
    expect(css).toContain(`url("/fonts/Baloo2-ExtraBold.ttf") format("truetype"); font-weight: 900`);
    expect(css).not.toMatch(/font-weight: \d+ \d+/);
  });
});
