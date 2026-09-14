import { describe, it, expect } from "vitest";
import { unicornSet } from "../fixtures/set-unicorn";
import { setPreview, shirtId } from "@/lib/setPreview";

const { input, style } = unicornSet();
const AT = new Date("2026-09-14T03:04:05Z");
/** A row as the home page hands it over; each spec overrides only the column it is about. */
const row = (over: Partial<Parameters<typeof setPreview>[0]> = {}) => ({
  id: "s1",
  input,
  style: null,
  memberStates: null,
  updatedAt: AT,
  ...over,
});
/** The birthday kid is `kids-1-9` in the fixture; `ayah` is the adult the tint must not follow. */
const KID = "kid";

describe("shirtId", () => {
  it("sends an adult to the adult silhouette and every child size to the kids one", () => {
    expect(shirtId("adult")).toBe("adult-flat");
    expect(shirtId("kids-1-9")).toBe("kids-flat");
    expect(shirtId("kids-0-1")).toBe("kids-flat");
  });
});

describe("setPreview", () => {
  it("uses the birthday kid's own mockup when the pipeline drew one", () => {
    const memberStates = { [KID]: { status: "ready" as const, previewUrl: "https://example.invalid/kid.jpg" } };
    expect(setPreview(row({ memberStates }))).toEqual({ kind: "mockup", url: "https://example.invalid/kid.jpg" });
  });

  // A batch set is drawn member by member, so the family can be ready while the kid is not — and the
  // kid's shirt is the one the card is about, never whichever preview happens to exist.
  it("ignores another member's mockup and falls back to the blank shirt", () => {
    const memberStates = { ayah: { status: "ready" as const, previewUrl: "https://example.invalid/ayah.jpg" } };
    expect(setPreview(row({ memberStates }))).toEqual({ kind: "blank", shirt: "kids-flat", color: "#ffffff" });
  });

  it("draws a blank shirt in the set's own colour for a set no tick has touched", () => {
    expect(setPreview(row({ input: { ...input, shirtColor: "#1f2937" } }))).toEqual({
      kind: "blank",
      shirt: "kids-flat",
      color: "#1f2937",
    });
  });

  it("takes the silhouette from the birthday kid's size, not the first member's", () => {
    const grown = { ...input, members: input.members.map(m => (m.id === KID ? { ...m, sizeClass: "adult" as const } : m)) };
    expect(setPreview(row({ input: grown }))).toMatchObject({ shirt: "adult-flat" });
  });

  // The home page renders rows whose stored input would not parse; the card must not be the thing
  // that turns a broken row into a 500 the shop cannot delete its way out of.
  it("answers nothing for input that would not parse", () => {
    expect(setPreview(row({ input: null }))).toBeNull();
  });

  it("treats a member state with no preview as no preview", () => {
    expect(setPreview(row({ memberStates: { [KID]: { status: "queued" as const } } }))).toMatchObject({ kind: "blank" });
    expect(setPreview(row({ memberStates: { [KID]: { status: "failed" as const, error: "x" } } }))).toMatchObject({ kind: "blank" });
  });
});

describe("setPreview, rendering a styled set", () => {
  it("points a styled set at its own render, stamped with the version it was read at", () => {
    expect(setPreview(row({ style }))).toEqual({
      kind: "render",
      url: `/api/set/s1/preview?v=${AT.getTime()}`,
      shirt: "kids-flat",
      color: "#ffffff",
    });
  });

  // The blank shirt travels with the render so `ShirtThumb` can draw it underneath: a render that is
  // still in flight, or one that failed, then shows an empty shirt rather than a broken image.
  it("carries the blank shirt along as the render's own fallback", () => {
    expect(setPreview(row({ style, input: { ...input, shirtColor: "#1f2937" } }))).toMatchObject({
      kind: "render",
      shirt: "kids-flat",
      color: "#1f2937",
    });
  });

  // A drawn mockup is already in Blob storage and costs nothing to show; re-rendering every batch
  // set the pipeline has finished would spend CPU to arrive at the same picture.
  it("still prefers a mockup the pipeline already drew", () => {
    const memberStates = { [KID]: { status: "ready" as const, previewUrl: "https://example.invalid/kid.jpg" } };
    expect(setPreview(row({ style, memberStates }))).toMatchObject({ kind: "mockup" });
  });

  it("leaves a set with no style on the blank shirt, which is all there is to draw", () => {
    expect(setPreview(row())).toMatchObject({ kind: "blank" });
  });

  // Two sets saved in the same millisecond still have different ids, so the URLs cannot collide.
  it("keys the version on the row's own updatedAt so an edit busts the cache", () => {
    const later = new Date(AT.getTime() + 1000);
    const a = setPreview(row({ style }));
    const b = setPreview(row({ style, updatedAt: later }));
    expect(a).not.toEqual(b);
    expect(b).toMatchObject({ url: `/api/set/s1/preview?v=${later.getTime()}` });
  });
});
