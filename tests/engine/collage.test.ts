import { describe, it, expect } from "vitest";
import { collage, NUMERAL_START_FRACTION } from "@/engine/templates/collage";
import { createNodeMeasurer } from "@/engine/measure";
import { boundingBox, isWithinSafeArea, boundingBoxCm, layerBounds, maxCm, canvasFor, safeArea } from "@/engine/sizing";
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

  it("every layer stays inside the safe area and the size limit, for all members, languages and size classes", () => {
    // The fixture covers adult and kids-1-9; kids-0-1 has the smallest canvas, so sweep a copy of
    // the set with every member forced to it as well.
    const variants = [
      { name: "as-authored", make: (s: ReturnType<typeof unicornSet>) => s },
      {
        name: "kids-0-1",
        make: (s: ReturnType<typeof unicornSet>) => {
          for (const m of s.input.members) m.sizeClass = "kids-0-1" as const;
          return s;
        },
      },
    ];
    for (const lang of ["en", "id"] as const) {
      for (const variant of variants) {
        const s = variant.make(unicornSet(lang));
        for (const m of s.input.members) {
          const d = collage(s, m, ctx);
          expect(isWithinSafeArea(d), `${lang}/${variant.name}/${m.label}`).toBe(true);
          expect(boundingBoxCm(d).longest, `${lang}/${variant.name}/${m.label}`).toBeLessThanOrEqual(maxCm(m.sizeClass));

          // Every text slot keeps real slack below it: the clamp stops short of the safe bottom,
          // so a downstream nudge cannot tip the design over the export limit.
          const A = safeArea(d.canvas);
          for (const l of d.layers) {
            if (l.type !== "text") continue;
            const b = layerBounds(l);
            expect(b.y + b.h, `${lang}/${variant.name}/${m.label}: ${l.id} bottom slack`)
              .toBeLessThanOrEqual(A.y + A.h - 0.004 * d.canvas.w);
          }

          // The clipart is allowed to overlap the numeral and the ordinal — in the reference sample
          // all three are composed as one mass, the small ordinal tucked into the artwork's own
          // negative space. The two full-width bands are the ones that must stay clear of it: a
          // name or a member label drawn across the artwork is the collision that ruins a shirt.
          const c = layerBounds(image(d, "clipart"));
          for (const l of d.layers) {
            if (l.type !== "text" || l.id === "numeral" || l.id === "ordinal") continue;
            const b = layerBounds(l);
            const overlaps = b.x < c.x + c.w && c.x < b.x + b.w && b.y < c.y + c.h && c.y < b.y + b.h;
            expect(overlaps, `${lang}/${variant.name}/${m.label}: ${l.id} overlaps clipart`).toBe(false);
          }
        }
      }
    }
  });

  /**
   * The composition is a portrait block, not a square one — `docs/samples/single_ayah.png` is
   * 2630x3389 and the artwork fills it. The canvas stays square because that is the print envelope
   * (`canvasFor`), so what has to be portrait is the ink: the block runs the full height of the
   * safe area and leaves the side margins that the ratio implies.
   */
  describe("portrait composition", () => {
    /** The reference sample's own width:height, and the slack a shrunken slot may move it by. */
    const SAMPLE_RATIO = 0.776;

    it.each(["en", "id"] as const)("keeps the reference sample's proportions in %s", lang => {
      const s = unicornSet(lang);
      for (const m of s.input.members) {
        const b = boundingBox(collage(s, m, ctx));
        expect(b.w / b.h, `${lang}/${m.id}`).toBeGreaterThan(SAMPLE_RATIO - 0.08);
        expect(b.w / b.h, `${lang}/${m.id}`).toBeLessThan(SAMPLE_RATIO + 0.08);
      }
    });

    it("fills the height it is given rather than floating in the middle", () => {
      const d = collage(set, set.input.members[0], ctx);
      const A = safeArea(canvasFor("adult"));
      expect(boundingBox(d).h).toBeGreaterThan(0.95 * A.h);
    });

    // Every line in the sample is set in caps. The renderer applies `transform` before drawing, so
    // this is also what `fitText` has to have measured — a slot that is uppercased at draw time but
    // measured in mixed case overflows its box.
    it("sets every line in caps, the way the sample does", () => {
      const d = collage(set, set.input.members[0], ctx);
      for (const id of ["top", "ordinal", "occasion", "bottom"]) {
        expect(text(d, id).transform, id).toBe("upper");
      }
    });
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

    // A narrow digit keeps the full start size — this is the reference sample's own case, a first
    // birthday, and the numeral there runs nearly the height of the shirt.
    const s1 = unicornSet("en"); s1.input.age = 1;
    const n1 = text(collage(s1, s1.input.members[0], ctx), "numeral");
    // Measured against the block's height, which is the safe area's, not the whole canvas side.
    expect(n1.size).toBe(NUMERAL_START_FRACTION * safeArea(canvasFor("adult")).h);
    // And a wider one is only ever smaller, never bigger.
    expect(n10.size).toBeLessThan(n1.size);
  });

});
