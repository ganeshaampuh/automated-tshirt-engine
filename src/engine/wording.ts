import type { Member, Set, Wording } from "./types";

export function ordinalSuffix(age: number): string {
  const mod100 = age % 100;
  if (mod100 >= 11 && mod100 <= 13) return "th";
  switch (age % 10) { case 1: return "st"; case 2: return "nd"; case 3: return "rd"; default: return "th"; }
}

/**
 * The shirt's words, which are English whatever `language` the shop recorded for the customer.
 *
 * The four slots sit at fixed fractions of the block in `collage`, so their length is part of the
 * layout rather than decoration: a second vocabulary is a second layout to keep true, and the
 * Indonesian one needed its own — "ke-" reads before the numeral, not beside it. One vocabulary is
 * one composition. `language` still travels to the model as context about the buyer, and still
 * picks the copy the shop itself reads; it no longer picks a word that gets printed.
 */
export function defaultWording(i: { kidName: string; age: number }): Wording {
  return { kidTop: "My", familyTop: i.kidName, ordinal: ordinalSuffix(i.age), occasion: "Birthday" };
}

export function resolveLines(set: Set, member: Member) {
  const w = set.style.wording;
  const isKid = member.kind === "birthday-kid";
  return {
    top: isKid ? w.kidTop : w.familyTop,
    ordinal: w.ordinal,
    occasion: w.occasion,
    bottom: isKid ? set.input.kidName : member.label,
  };
}
