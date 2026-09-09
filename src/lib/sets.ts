import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { expand, isAllowedImageSrc, type Set, type TextMeasurer } from "@/engine";
import { exportPrintPng, renderMockup, loadShirtAsset, defaultShirtFor, type RenderOpts } from "@/engine/server";
import { zipFiles } from "./zip";
import { fetchRemoteImage, RemoteImageError, MAX_REMOTE_BYTES } from "./remoteImage";
import { MAX_INPUT_PIXELS } from "./upload";

export type ClipartSize = { w: number; h: number };
export type ExportDeps = { measure: TextMeasurer; clipartSize: ClipartSize; loadImage: RenderOpts["loadImage"]; cache?: ByteCache };

/**
 * Remembers the bytes of a remote src for the length of one export.
 *
 * A four-member set asks for the same clipart nine times (once for its size, then a print PNG and a
 * mockup each), and every miss is another 15-second request aimed at whatever host the spreadsheet
 * named. One fetch per src per export keeps batch mode from becoming an amplifier.
 */
export type ByteCache = Map<string, Promise<Buffer>>;
export const newByteCache = (): ByteCache => new Map();

/** Filesystem/zip-safe slug that keeps non-ASCII letters (Indonesian names). */
const slug = (s: string) => s.trim().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");

export function buildDesigns(set: Set, measure: TextMeasurer, clipartSize: ClipartSize) {
  return expand(set, { measure, clipart: clipartSize });
}

/**
 * Reads bytes for a `data:` URL, a remote URL or a local path.
 *
 * The local-path branch is only ever handed paths this app itself produced — the shirt and mockup
 * assets it ships and the test fixtures. Anything a customer can influence arrives as `https:` and
 * goes through `fetchRemoteImage`, which is the only place this app fetches a URL it did not
 * construct (`SetStyleSchema.clipartSrc` enforces that shape at the edge).
 */
export async function fetchBytes(src: string, cache?: ByteCache): Promise<Buffer> {
  if (src.startsWith("data:")) {
    const b64 = src.slice(src.indexOf(",") + 1);
    // Same ceiling as a network fetch: a `data:` clipart is inline bytes, not a free pass.
    if (Math.ceil((b64.length * 3) / 4) > MAX_REMOTE_BYTES) throw new RemoteImageError("Gambar terlalu besar.");
    return Buffer.from(b64, "base64");
  }
  if (!/^https?:/i.test(src)) return readFile(src);
  const hit = cache?.get(src);
  if (hit) return hit;
  const pending = fetchRemoteImage(src).then(assertDecodable);
  cache?.set(src, pending);
  return pending;
}

/**
 * Refuses a decompression bomb before anything decodes it. Remote bytes are capped at 16 MB, but a
 * few of those megabytes can expand into gigabytes of raw pixels — the same ceiling uploads get.
 */
async function assertDecodable(bytes: Buffer): Promise<Buffer> {
  let width: number | undefined, height: number | undefined;
  try {
    ({ width, height } = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS }).metadata());
  } catch {
    throw new RemoteImageError("Gambar itu tidak bisa dibaca.");
  }
  if (!width || !height) throw new RemoteImageError("Gambar itu tidak bisa dibaca.");
  if (width * height > MAX_INPUT_PIXELS) throw new RemoteImageError("Gambar terlalu besar.");
  return bytes;
}

/**
 * Wraps a `loadImage` so the renderer can never reach anything on its own.
 *
 * A remote src is fetched through the guard rather than by the image decoder, which would happily
 * follow any URL; every other src must be a `data:` image or a path this app ships, because a
 * member override can put an arbitrary string in a layer's `src` and `loadImageFromFile` would
 * `readFile` it straight into the ZIP the shop downloads. Nothing falls through.
 */
export function guardRemoteImages(loadImage: RenderOpts["loadImage"], cache: ByteCache = newByteCache()): RenderOpts["loadImage"] {
  return async src => {
    if (/^https?:/i.test(src)) {
      const bytes = await fetchBytes(src, cache);
      return loadImage(`data:application/octet-stream;base64,${bytes.toString("base64")}`);
    }
    if (!src.startsWith("data:image/") && !isAllowedImageSrc(src)) throw new RemoteImageError("Sumber gambar tidak diizinkan.");
    return loadImage(src);
  };
}

/** Intrinsic pixel size of the clipart, which `expand` needs to keep its aspect ratio. */
export async function clipartSize(src: string, cache?: ByteCache): Promise<ClipartSize> {
  const { width, height } = await sharp(await fetchBytes(src, cache), { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  if (!width || !height) throw new Error(`Could not read clipart dimensions from ${src}`);
  return { w: width, h: height };
}

/**
 * Renders every member: one print-ready PNG plus a 2000px mockup JPEG, zipped.
 * `sizes` is keyed by member id and reports the printed size in cm.
 */
export async function exportSetZip(set: Set, deps: ExportDeps) {
  const files: { name: string; data: Buffer }[] = [];
  const sizes: Record<string, { widthCm: number; heightCm: number }> = {};
  const loadImage = guardRemoteImages(deps.loadImage, deps.cache ?? newByteCache());
  for (const { memberId, design } of buildDesigns(set, deps.measure, deps.clipartSize)) {
    const member = set.input.members.find(m => m.id === memberId);
    if (!member) throw new Error(`Unknown member ${memberId}`);
    const base = `${slug(set.input.kidName)}-${slug(member.label)}`;
    const print = await exportPrintPng(design, loadImage);
    files.push({ name: `${base}.png`, data: print.png });
    sizes[memberId] = { widthCm: print.widthCm, heightCm: print.heightCm };
    const shirt = await loadShirtAsset(defaultShirtFor(design.sizeClass));
    files.push({ name: `${base}.mockup.jpg`, data: await renderMockup(design, shirt, { loadImage, width: 2000 }) });
  }
  return { zip: zipFiles(files), sizes };
}
