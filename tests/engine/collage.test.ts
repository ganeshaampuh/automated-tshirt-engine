import { describe, it, expect } from "vitest";
import { collage } from "@/engine/templates/collage";
import { createNodeMeasurer } from "@/engine/measure";
import { isWithinSafeArea, boundingBoxCm, maxCm, canvasFor } from "@/engine/sizing";
import { unicornSet, CLIPART_SIZE } from "../fixtures/set-unicorn";
import type { TextLayer, ImageLayer } from "@/engine/types";

const measure = createNodeMeasurer();
const ctx = { measure, clipart: CLIPART_SIZE };
const text = (d: ReturnType<typeof collage>, id: string) => d.layers.find(l => l.id === id) as TextLayer;
const image = (d: ReturnType<typeof collage>, id: string) => d.layers.find(l => l.id === id) as ImageLayer;

describe("collage template", () => {
  const set = unicornSet("en");

  it("produces the six slots with fixed ids", () => {
    const d = collage(set, set.input.members[0], ctx);
    expect(d.layers.map(l => l.id)).toEqual(["numeral", "clipart", "top", "ordinal", "occasion", "bottom"]);
  });

  it("uses the member's canvas size", () => {
    expect(collage(set, set.input.members[0], ctx).canvas).toEqual(canvasFor("adult"));
    expect(collage(set, set.input.members[1], ctx).canvas).toEqual(canvasFor("kids-1-9"));
  });

  it("kid vs family wording", () => {
    const kid = collage(set, set.input.members[1], ctx);
    const ayah = collage(set, set.input.members[0], ctx);
    expect(text(kid, "top").text).toBe("My");
    expect(text(kid, "bottom").text).toBe("Keisya");
    expect(text(ayah, "top").text).toBe("Keisya");
    expect(text(ayah, "bottom").text).toBe("Ayah");
    expect(text(ayah, "numeral").text).toBe("5");
    expect(text(ayah, "numeral").stroke?.color).toBe("#e6007e");
  });

  it("every layer stays inside the safe area and the size limit, for all members and languages", () => {
    for (const lang of ["en", "id"] as const) {
      const s = unicornSet(lang);
      for (const m of s.input.members) {
        const d = collage(s, m, ctx);
        expect(isWithinSafeArea(d), `${lang}/${m.label}`).toBe(true);
        expect(boundingBoxCm(d).longest).toBeLessThanOrEqual(maxCm(m.sizeClass));
      }
    }
  });

  it("clipart preserves aspect ratio and overlaps the numeral", () => {
    const d = collage(set, set.input.members[0], ctx);
    const c = image(d, "clipart"), n = text(d, "numeral");
    expect(c.w / c.h).toBeCloseTo(CLIPART_SIZE.w / CLIPART_SIZE.h, 2);
    expect(c.x).toBeLessThan(n.x + n.maxWidth);
  });

  it("long names shrink to fit", () => {
    const s = unicornSet("en");
    s.input.kidName = "Muhammad Rizky Ramadhan Putra";
    s.style.wording.familyTop = s.input.kidName;
    const d = collage(s, s.input.members[0], ctx);
    const t = text(d, "top");
    expect(t.text).toBe(s.input.kidName);
    expect(measure.width(t.text, t.font, t.weight, t.size)).toBeLessThanOrEqual(t.maxWidth);
    expect(t.size).toBeLessThan(0.13 * canvasFor("adult").w);
  });

  it("numeral shrinks to fit for large ages, but not for small ones", () => {
    const s10 = unicornSet("en"); s10.input.age = 10;
    const s100 = unicornSet("en"); s100.input.age = 100;
    const d10 = collage(s10, s10.input.members[0], ctx);
    const d100 = collage(s100, s100.input.members[0], ctx);
    const n10 = text(d10, "numeral"), n100 = text(d100, "numeral");
    expect(measure.width(n10.text, n10.font, n10.weight, n10.size)).toBeLessThanOrEqual(n10.maxWidth);
    expect(measure.width(n100.text, n100.font, n100.weight, n100.size)).toBeLessThanOrEqual(n100.maxWidth);

    const d5 = collage(set, set.input.members[0], ctx);
    const n5 = text(d5, "numeral");
    expect(n5.size).toBe(0.60 * canvasFor("adult").w);
  });

  it("indonesian moves ordinal before the numeral", () => {
    const s = unicornSet("id");
    const d = collage(s, s.input.members[0], ctx);
    expect(text(d, "ordinal").text).toBe("ke-");
    expect(text(d, "ordinal").y).toBeLessThan(text(d, "numeral").y);
  });
});
