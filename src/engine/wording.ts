import type { Language, Member, Set, Wording } from "./types";

export function ordinalSuffix(age: number, lang: Language): string {
  if (lang === "id") return "ke-";
  const mod100 = age % 100;
  if (mod100 >= 11 && mod100 <= 13) return "th";
  switch (age % 10) { case 1: return "st"; case 2: return "nd"; case 3: return "rd"; default: return "th"; }
}

export function defaultWording(i: { kidName: string; age: number; language: Language }): Wording {
  if (i.language === "id") {
    return { kidTop: "Ulang Tahunku", familyTop: i.kidName, ordinal: ordinalSuffix(i.age, "id"), occasion: "Ulang Tahun" };
  }
  return { kidTop: "My", familyTop: i.kidName, ordinal: ordinalSuffix(i.age, "en"), occasion: "Birthday" };
}

export function resolveLines(set: Set, member: Member) {
  const w = set.style.wording;
  const isKid = member.kind === "birthday-kid";
  return {
    top: isKid ? w.kidTop : w.familyTop,
    ordinal: w.ordinal,
    occasion: w.occasion,
    bottom: isKid ? set.input.kidName : member.label,
    ordinalBeforeNumeral: set.input.language === "id",
  };
}
