import sharp, { type Sharp } from "sharp";
import { MAX_INPUT_PIXELS } from "./upload";

/**
 * Lifts a flat background off a clipart, leaving the artwork on transparency.
 *
 * The fill starts at the border and spreads inwards, so only background that *touches the edge*
 * is taken. White inside the drawing — an eye, a tooth, the gleam on a unicorn's horn — is
 * enclosed by ink, never reached, and survives. A global "near-white becomes transparent" pass
 * cannot tell those apart and punches holes in the artwork.
 *
 * The key colour is read off the border rather than assumed to be white, so a clipart sitting on
 * flat blue is cut out the same way.
 *
 * Two things are deliberately left alone: an image that already carries transparency (somebody cut
 * it out by hand; it is only trimmed), and one `isBackgroundRemovable` rejects.
 */

/** Colour distance below which a pixel counts as background outright. */
const INNER_TOLERANCE = 32;

/**
 * Distance above which a pixel counts as artwork outright. Between the two the pixel is a fringe
 * pixel and gets partial alpha — that band is what removes the white halo around an edge that was
 * anti-aliased or saved as JPEG.
 */
const OUTER_TOLERANCE = 96;

export type BackgroundStats = {
  /** Share of border pixels within `INNER_TOLERANCE` of the key colour — how flat the border is. */
  borderMatchRatio: number;
  /** Share of the whole image the flood fill claimed. */
  filledRatio: number;
};

/**
 * Whether the flood fill's result should be kept.
 *
 * **These two numbers are the shop's call, not the algorithm's — tune them against real clipart.**
 * They are set to a working starting point so the suite stays green; both failure modes cost a
 * reprint, and they pull in opposite directions:
 *
 *   - `borderMatchRatio` too low and there was never a flat background to lift — a photograph, a
 *     clipart on a gradient. Keeping the mask tears holes in the picture. Too strict, though, and
 *     a clean clipart whose border carries slight JPEG noise keeps its white box and prints it.
 *   - `filledRatio` near 1 means the fill ate the image: it found no artwork to stop at. Careful
 *     with this one — a small motif on a big canvas is legitimately most of the frame. The test
 *     "lifts a solid colour background" sits at 0.90 and must be kept, so the ceiling has to
 *     clear it with room to spare.
 */
export function isBackgroundRemovable(stats: BackgroundStats): boolean {
  return stats.borderMatchRatio >= 0.9 && stats.filledRatio <= 0.97;
}

/** Euclidean distance between two RGB triples. */
function distance(data: Uint8Array | Buffer, i: number, key: [number, number, number]): number {
  const dr = data[i] - key[0], dg = data[i + 1] - key[1], db = data[i + 2] - key[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/** Every index on the one-pixel ring around the image, as raw-buffer offsets. */
function borderOffsets(width: number, height: number): number[] {
  const out: number[] = [];
  for (let x = 0; x < width; x++) {
    out.push(x * 4);
    out.push(((height - 1) * width + x) * 4);
  }
  for (let y = 1; y < height - 1; y++) {
    out.push(y * width * 4);
    out.push((y * width + width - 1) * 4);
  }
  return out;
}

/**
 * The background colour, taken as the mean of the commonest border bucket.
 *
 * Quantising to 16 levels per channel first means a border that is "white, give or take the noise
 * a JPEG left" lands in one bucket; averaging the members back gives a key that is not shifted by
 * whatever the darkest corner happened to be.
 */
function keyColour(data: Buffer, offsets: number[]): [number, number, number] {
  const counts = new Map<number, number>();
  for (const i of offsets) {
    const bucket = ((data[i] & 0xf0) << 8) | ((data[i + 1] & 0xf0) << 4) | (data[i + 2] >> 4);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  let best = 0, bestCount = -1;
  for (const [bucket, n] of counts) if (n > bestCount) { best = bucket; bestCount = n; }
  let r = 0, g = 0, b = 0, n = 0;
  for (const i of offsets) {
    const bucket = ((data[i] & 0xf0) << 8) | ((data[i + 1] & 0xf0) << 4) | (data[i + 2] >> 4);
    if (bucket !== best) continue;
    r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
  }
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

/** `.trim()` throws on a fully transparent image; the untrimmed PNG is the answer when it does. */
async function trimmedPng(image: Sharp, fallback: Sharp): Promise<Buffer> {
  try {
    return await image.trim().png().toBuffer();
  } catch {
    return await fallback.png().toBuffer();
  }
}

export async function removeBackground(png: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(png, { limitInputPixels: MAX_INPUT_PIXELS })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const raw = { raw: { width, height, channels: 4 as const } };

  // Already cut out by hand: the fill has no business guessing at a background that is gone.
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 250) return trimmedPng(sharp(data, raw), sharp(data, raw));
  }

  const offsets = borderOffsets(width, height);
  const key = keyColour(data, offsets);
  const borderMatchRatio = offsets.filter(i => distance(data, i, key) <= INNER_TOLERANCE).length / offsets.length;

  // Flood fill inwards from every border pixel that matches, four-connected. The stack holds pixel
  // indices rather than coordinates, and `filled` doubles as the visited set, so a 16 MP clipart
  // costs one byte per pixel and no allocation per step.
  const filled = new Uint8Array(width * height);
  const stack: number[] = [];
  for (const off of offsets) {
    const p = off >> 2;
    if (!filled[p] && distance(data, off, key) <= INNER_TOLERANCE) { filled[p] = 1; stack.push(p); }
  }
  let filledCount = stack.length;
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % width, y = (p - x) / width;
    if (x > 0) push(p - 1);
    if (x < width - 1) push(p + 1);
    if (y > 0) push(p - width);
    if (y < height - 1) push(p + width);
  }
  function push(q: number) {
    if (filled[q]) return;
    if (distance(data, q * 4, key) > INNER_TOLERANCE) return;
    filled[q] = 1; filledCount++; stack.push(q);
  }

  if (!isBackgroundRemovable({ borderMatchRatio, filledRatio: filledCount / (width * height) })) return png;

  for (let p = 0; p < filled.length; p++) if (filled[p]) data[p * 4 + 3] = 0;

  // Feather: a pixel the fill stopped at, but whose colour is still part-way to the background, is
  // the anti-aliased fringe. Ramping its alpha across the tolerance band is what stops a cut-out
  // from printing with a pale outline around it.
  for (let p = 0; p < filled.length; p++) {
    if (filled[p] || data[p * 4 + 3] === 0) continue;
    const x = p % width, y = (p - x) / width;
    const touchesBackground =
      (x > 0 && filled[p - 1]) || (x < width - 1 && filled[p + 1]) ||
      (y > 0 && filled[p - width]) || (y < height - 1 && filled[p + width]);
    if (!touchesBackground) continue;
    const d = distance(data, p * 4, key);
    if (d >= OUTER_TOLERANCE) continue;
    data[p * 4 + 3] = Math.round((255 * Math.max(0, d - INNER_TOLERANCE)) / (OUTER_TOLERANCE - INNER_TOLERANCE));
  }

  return trimmedPng(sharp(data, raw), sharp(data, raw));
}
