import { describe, it, expect } from "vitest";
import { ordinalSuffix, defaultWording, resolveLines } from "@/engine/wording";
import type { Set } from "@/engine/types";

const set = (language: "en" | "id"): Set => ({
  input: { kidName: "Keisya", age: 5, theme: "unicorn", shirtColor: "#ffffff", language,
    members: [
      { id: "k", kind: "birthday-kid", label: "Keisya", sizeClass: "kids-1-9" },
      { id: "a", kind: "family", label: "Ayah", sizeClass: "adult" },
    ] },
  style: { template: "collage", font: "Fredoka", palette: { primary: "#e6007e", secondary: "#f9a8d4", outline: "#e6007e" },
    clipartSrc: "x", wording: defaultWording({ kidName: "Keisya", age: 5 }) },
});

describe("ordinalSuffix", () => {
  it("english", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101].map(n => ordinalSuffix(n)))
      .toEqual(["st", "nd", "rd", "th", "th", "th", "th", "st", "nd", "rd", "st"]);
  });
});

describe("defaultWording", () => {
  /**
   * The shirt is set in English whatever language the shop filled in for the customer: the four
   * slots sit at fixed fractions of the block, and one vocabulary is one layout to keep true.
   * `language` still reaches the model as context about the buyer; it no longer picks any word.
   */
  it("takes no language and reads english", () => {
    expect(defaultWording({ kidName: "Keisya", age: 5 }))
      .toEqual({ kidTop: "My", familyTop: "Keisya", ordinal: "th", occasion: "Birthday" });
  });
});

describe("resolveLines", () => {
  it("english kid and family", () => {
    const s = set("en");
    expect(resolveLines(s, s.input.members[0])).toEqual({ top: "My", ordinal: "th", occasion: "Birthday", bottom: "Keisya" });
    expect(resolveLines(s, s.input.members[1])).toEqual({ top: "Keisya", ordinal: "th", occasion: "Birthday", bottom: "Ayah" });
  });
  it("reads the same for an indonesian set", () => {
    const s = set("id");
    expect(resolveLines(s, s.input.members[0])).toEqual({ top: "My", ordinal: "th", occasion: "Birthday", bottom: "Keisya" });
  });
});
