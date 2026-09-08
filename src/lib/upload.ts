import sharp from "sharp";

/**
 * Limits for a clipart upload, shared by the browser (which rejects early, before a doomed
 * round-trip) and the Server Action (which cannot trust the browser).
 *
 * `MAX_UPLOAD_BYTES` sits under the Server Action `bodySizeLimit` in `next.config.ts`, so an
 * accepted file always fits in the request; the slack covers FormData framing.
 */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export const MAX_UPLOAD_MESSAGE = "Ukuran gambar maksimal 8 MB. Kecilkan dulu, ya.";

/**
 * Decode guard against a decompression bomb: 100 MP is well past any phone camera (a 50 MP photo
 * is 8160x6120) while refusing an image that would need gigabytes of raw pixels.
 */
export const MAX_INPUT_PIXELS = 100_000_000;

/**
 * Longest edge kept in storage. The widest print canvas is 3425 px, so 4096 px still lets a clipart
 * fill it edge to edge with room to spare, and nothing downstream can ask for more.
 */
export const MAX_CLIPART_PX = 4096;

/**
 * Normalises an uploaded image to a PNG: blank borders trimmed, longest edge capped at
 * `MAX_CLIPART_PX`. Nothing else — no background removal.
 */
export async function processClipartUpload(bytes: Buffer): Promise<{ png: Buffer; width: number; height: number }> {
  const source = sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS }).resize({
    width: MAX_CLIPART_PX,
    height: MAX_CLIPART_PX,
    fit: "inside",
    withoutEnlargement: true,
  });
  const png = await source.trim().png().toBuffer().catch(() => source.png().toBuffer());
  const { width = 0, height = 0 } = await sharp(png).metadata();
  return { png, width, height };
}
