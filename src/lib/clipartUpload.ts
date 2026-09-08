import sharp from "sharp";
import { MAX_CLIPART_PX, MAX_INPUT_PIXELS } from "./upload";

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
