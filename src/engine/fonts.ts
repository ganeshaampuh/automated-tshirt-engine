/**
 * Font metadata. Pure and browser-safe — no `node:*`, no filesystem.
 *
 * Every family ships as **static instances**, one file per weight, never a variable font.
 * `@napi-rs/canvas` (skia) does not apply a variable font's `wght` axis: it draws the file's
 * default instance whatever the `font` string asks for, while Chrome does apply it. With static
 * faces both engines pick the same file for the same weight, so what the browser measures is what
 * the print renderer draws.
 */

export type FontWeight = 400 | 700 | 900;
export type FontFace = { weight: FontWeight; file: string };

export const FONT_REGISTRY: Record<string, { faces: FontFace[] }> = {
  "Fredoka":      { faces: [{ weight: 400, file: "Fredoka-Regular.ttf" }, { weight: 700, file: "Fredoka-Bold.ttf" }] },
  "Baloo 2":      { faces: [{ weight: 400, file: "Baloo2-Regular.ttf" }, { weight: 700, file: "Baloo2-Bold.ttf" }, { weight: 900, file: "Baloo2-ExtraBold.ttf" }] },
  "Chewy":        { faces: [{ weight: 400, file: "Chewy.ttf" }] },
  "Bangers":      { faces: [{ weight: 400, file: "Bangers.ttf" }] },
  "Lilita One":   { faces: [{ weight: 400, file: "LilitaOne.ttf" }] },
  "Luckiest Guy": { faces: [{ weight: 400, file: "LuckiestGuy.ttf" }] },
};

export const CURATED_FONTS = Object.keys(FONT_REGISTRY);
export const DEFAULT_FONT = "Fredoka";

function entry(family: string) {
  const e = FONT_REGISTRY[family];
  if (!e) throw new Error(`Unknown font family: ${family}`);
  return e;
}

/** The weights a family actually ships, ascending. */
export const fontWeights = (family: string): FontWeight[] => entry(family).faces.map(f => f.weight);

/**
 * The shipped weight closest to `weight`. A single-weight family resolves every request to its one
 * face, so a layer asking for 700 in Chewy measures and draws the same 400 file everywhere.
 * Ties go to the lighter face.
 */
export function nearestWeight(family: string, weight: number): FontWeight {
  const faces = entry(family).faces;
  let best = faces[0];
  for (const f of faces) if (Math.abs(f.weight - weight) < Math.abs(best.weight - weight)) best = f;
  return best.weight;
}

/** The face file a family/weight pair resolves to. */
export function fontFace(family: string, weight: number): FontFace {
  const w = nearestWeight(family, weight);
  return entry(family).faces.find(f => f.weight === w)!;
}

/** URL path the browser loads a face from (served from public/). */
export const fontUrl = (family: string, weight: number = 400) => `/fonts/${fontFace(family, weight).file}`;
