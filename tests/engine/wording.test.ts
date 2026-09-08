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
    clipartSrc: "x", wording: defaultWording({ kidName: "Keisya", age: 5, language }) },
});

describe("ordinalSuffix", () => {
  it("english", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101].map(n => ordinalSuffix(n, "en")))
      .toEqual(["st", "nd", "rd", "th", "th", "th", "th", "st", "nd", "rd", "st"]);
  });
  it("indonesian", () => expect(ordinalSuffix(5, "id")).toBe("ke-"));
});

describe("resolveLines", () => {
  it("english kid and family", () => {
    const s = set("en");
    expect(resolveLines(s, s.input.members[0])).toEqual({ top: "My", ordinal: "th", occasion: "Birthday", bottom: "Keisya", ordinalBeforeNumeral: false });
    expect(resolveLines(s, s.input.members[1])).toEqual({ top: "Keisya", ordinal: "th", occasion: "Birthday", bottom: "Ayah", ordinalBeforeNumeral: false });
  });
  it("indonesian puts ordinal before numeral", () => {
    const s = set("id");
    expect(resolveLines(s, s.input.members[0])).toEqual({ top: "Ulang Tahunku", ordinal: "ke-", occasion: "Ulang Tahun", bottom: "Keisya", ordinalBeforeNumeral: true });
  });
});
