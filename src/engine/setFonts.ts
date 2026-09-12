import { CURATED_FONTS, DEFAULT_FONT } from "./fonts";
import type { SetInput, SetStyle } from "./types";

/**
 * Every font family a set can actually draw with, so the browser fetches those faces and no others.
 *
 * Read from the stored documents rather than from an expanded `Design`, and deliberately so: a
 * design only exists once the text has been measured, and measuring needs the font loaded. Taking
 * the families from `style.font` and the members' overrides breaks that circle — both are plain
 * data, available before the first measurement.
 *
 * An override is `unknown` by the schema's own admission, so a family that is not curated is
 * dropped here; `applyOverrides` would reject it downstream anyway, and no face exists to load.
 */
export function setFonts(input: SetInput, style: SetStyle | null): string[] {
  const found = new Set<string>([style?.font ?? DEFAULT_FONT]);
  for (const m of input.members) {
    for (const layer of Object.values(m.overrides ?? {})) {
      const font = layer.font;
      if (typeof font === "string" && CURATED_FONTS.includes(font)) found.add(font);
    }
  }
  return [...found].filter(f => CURATED_FONTS.includes(f));
}
