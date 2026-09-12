import sharp from "sharp";
import { removeBackground } from "./removeBackground";
import { MAX_CLIPART_PX, MAX_INPUT_PIXELS } from "./upload";

/**
 * Normalises an uploaded image to a PNG: longest edge capped at `MAX_CLIPART_PX`, then a flat
 * background lifted and the result trimmed by `removeBackground`.
 *
 * The cap comes first so the flood fill never walks more pixels than storage will keep — an 8 MB
 * upload can decode to 100 MP, and the fill is linear in pixels.
 */
export async function processClipartUpload(bytes: Buffer): Promise<{ png: Buffer; width: number; height: number }> {
  const capped = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS })
    .resize({ width: MAX_CLIPART_PX, height: MAX_CLIPART_PX, fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();
  const png = await removeBackground(capped);
  const { width = 0, height = 0 } = await sharp(png).metadata();
  return { png, width, height };
}
