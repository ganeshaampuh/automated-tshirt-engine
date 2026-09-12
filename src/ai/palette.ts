/**
 * Colour arithmetic for turning a clipart into a shirt's palette.
 *
 * Kept apart from `style.ts` because none of it needs a model, an image or a network: these are
 * functions from hex to hex, and the decisions they encode — what counts as a colour, how a numeral
 * fill relates to its stroke — are the ones most worth pinning in a test.
 */

/**
 * The colour a shirt falls back to when its clipart has no colour of its own.
 *
 * This magenta is the app's house colour: it is what `fallbackStyle` has always started from, what
 * the fixtures carry and what `docs/samples/` is printed in.
 */
export const HOUSE_ACCENT = "#e6007e";

/** How saturated a colour has to be before it counts as a colour rather than as ink. */
const ACCENT_MIN_SATURATION = 0.15;
/** What the accent is rebuilt at: enough saturation to read as a colour, dark enough to print. */
const ACCENT_SATURATION = 0.75;
const ACCENT_LIGHTNESS = { min: 0.35, max: 0.55 };

const channels = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const hex2 = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
const toHex = (r: number, g: number, b: number) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

export type Hsl = { h: number; s: number; l: number };

export function toHsl(hex: string): Hsl {
  const [r, g, b] = channels(hex).map(v => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

export function fromHsl({ h, s, l }: Hsl): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return toHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

/**
 * The colour a person would name if asked what colour a clipart is.
 *
 * Not simply the first of `dominantColors`, which ranks by area: a cartoon is mostly its own
 * outline ink, so the most common colour in Hello Kitty is black and the design that follows from
 * it is a black shirt. Anything too grey to be a colour is skipped, and the most saturated of what
 * is left wins — the bow, the mane, the hat.
 *
 * The winner's *hue* is kept and everything else about it rebuilt. A clipart drawn in pastels is
 * genuinely pale, and using its colour as found leaves the text washed out — or, worse, sends
 * `ensureContrast` walking it towards grey one step at a time until it barely clears the threshold.
 * Setting the saturation and lightness once, up front, gives back a colour of the same family that
 * can carry a shirt.
 */
export function accentColor(dominant: string[], fallback = HOUSE_ACCENT): string {
  const candidates = dominant
    .map(hex => ({ hex, hsl: toHsl(hex) }))
    .filter(c => c.hsl.s >= ACCENT_MIN_SATURATION);
  if (candidates.length === 0) return fallback;

  const best = candidates.reduce((a, b) => (b.hsl.s > a.hsl.s ? b : a));
  return fromHsl({
    h: best.hsl.h,
    s: Math.max(best.hsl.s, ACCENT_SATURATION),
    l: Math.min(ACCENT_LIGHTNESS.max, Math.max(ACCENT_LIGHTNESS.min, best.hsl.l)),
  });
}

/** Mixes a colour towards white. 0 leaves it alone, 1 is white. */
export const tint = (hex: string, amount: number) =>
  toHex(...(channels(hex).map(v => v * (1 - amount) + 255 * amount) as [number, number, number]));

const lum = (hex: string) =>
  channels(hex).map(v => v / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((acc, c, i) => acc + [0.2126, 0.7152, 0.0722][i] * c, 0);

export const contrastRatio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const mix = (hex: string, t: number, toward: number) =>
  toHex(...(channels(hex).map(v => v * (1 - t) + toward * t) as [number, number, number]));

export function ensureContrast(color: string, against: string, min = 3): string {
  let c = color.toLowerCase();
  const toward = lum(against) > 0.5 ? 0 : 255;
  for (let i = 0; i < 20 && contrastRatio(c, against) < min; i++) c = mix(c, 0.1, toward);
  return c;
}

/**
 * Whether two colours are far enough apart in light to be told apart when one is drawn inside the
 * other — the numeral's fill inside its own stroke.
 *
 * Measured as contrast rather than as a hex difference: #222222 and #111111 are different colours
 * by any string comparison and the same blob to a person across a room.
 */
export const distinct = (a: string, b: string, min = 1.6) => contrastRatio(a, b) >= min;
