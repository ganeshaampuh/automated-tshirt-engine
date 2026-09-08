import { describe, it, expect } from "vitest";
import { CURATED_FONTS, fontWeights, nearestWeight } from "@/engine";
import { WEIGHT_LABEL } from "@/app/set/[id]/components/labels";

/**
 * The Inspector's weight select lists `fontWeights(layer.font)` and labels each option with
 * WEIGHT_LABEL. Two invariants keep that control honest: every option is labelled, and whatever
 * weight a layer carries after a font switch is one of the options (a `<select>` whose value is
 * absent from its options renders blank).
 */
describe("weight control options", () => {
  it("labels every weight any curated family ships", () => {
    for (const family of CURATED_FONTS) {
      for (const w of fontWeights(family)) expect(WEIGHT_LABEL[w]).toBeTruthy();
    }
  });

  it("retargets a weight onto a face the new family actually ships", () => {
    for (const family of CURATED_FONTS) {
      const options = fontWeights(family);
      for (const requested of [400, 700, 900]) {
        expect(options).toContain(nearestWeight(family, requested));
      }
    }
  });

  it("leaves single-weight families with nothing to choose", () => {
    expect(fontWeights("Chewy")).toHaveLength(1);
    expect(fontWeights("Baloo 2").length).toBeGreaterThan(1);
  });
});
