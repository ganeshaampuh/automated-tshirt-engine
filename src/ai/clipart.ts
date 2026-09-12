import sharp from "sharp";
import { z } from "zod";
import type { AIProvider } from "./provider";
import { fetchBytes, type ByteCache } from "@/lib/sets";
import { MAX_INPUT_PIXELS } from "@/lib/upload";
import { removeBackground } from "@/lib/removeBackground";
import { clipartPrompt, describeSystem } from "./prompts";

export type ClipartMeta = { width: number; height: number; dominantColors: string[]; caption: string; kind: "photo" | "illustration" | "logo" | "pattern" };
const DescribeSchema = z.object({ caption: z.string(), kind: z.enum(["photo", "illustration", "logo", "pattern"]) });

export async function dominantColors(png: Buffer, n = 5): Promise<string[]> {
  const { data } = await sharp(png, { limitInputPixels: MAX_INPUT_PIXELS }).ensureAlpha().resize(64, 64, { fit: "inside" }).raw().toBuffer({ resolveWithObject: true });
  const counts = new Map<string, number>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const r = data[i] & 0xf0, g = data[i + 1] & 0xf0, b = data[i + 2] & 0xf0; // quantise to 16 levels
    if (r >= 0xe0 && g >= 0xe0 && b >= 0xe0) continue; // near-white
    const key = `#${[r | (r >> 4), g | (g >> 4), b | (b >> 4)].map(v => v.toString(16).padStart(2, "0")).join("")}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
}

export async function generateClipart(theme: string, deps: { provider: AIProvider; putBlob: (path: string, body: Buffer, contentType: string) => Promise<string> }) {
  const raw = await deps.provider.generateImage({ prompt: clipartPrompt(theme) });
  const png = await removeBackground(raw);
  const { width = 0, height = 0 } = await sharp(png).metadata();
  const url = await deps.putBlob(`clipart/${Date.now()}-${theme.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`, png, "image/png");
  return { url, width, height };
}

export async function describeClipart(
  src: string | Buffer,
  // `cache` is the caller's per-set `ByteCache`. Without it this is a second fetch of the very src
  // `clipartSize` is about to read — two outbound requests per set, four hundred for a batch of two
  // hundred, at whatever host the spreadsheet named. `src/lib/sets.ts` states the invariant: one
  // fetch per src per export.
  deps: { provider: AIProvider; cache?: ByteCache },
): Promise<ClipartMeta> {
  // A string src is a `clipartSrc`, which the shop (and, in batch mode, a spreadsheet) supplies:
  // read it through the same guarded door the exporter uses, never with a bare `fetch`.
  const buf = Buffer.isBuffer(src) ? src : await fetchBytes(src, deps.cache);
  // Every decode of these bytes carries the upload pixel ceiling: `src` is attacker-chosen in batch
  // mode, and 16 MB of PNG can still unpack into gigabytes of raw pixels.
  const { width = 0, height = 0 } = await sharp(buf, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  const [colors, small] = await Promise.all([
    dominantColors(buf),
    sharp(buf, { limitInputPixels: MAX_INPUT_PIXELS }).resize(512, 512, { fit: "inside" }).png().toBuffer(),
  ]);
  let caption = "", kind: ClipartMeta["kind"] = "illustration";
  try {
    const r = await deps.provider.chatJSON({ system: describeSystem, user: "Describe this image.", images: [`data:image/png;base64,${small.toString("base64")}`], schema: DescribeSchema });
    caption = r.caption; kind = r.kind;
  } catch { /* vision is best-effort; defaults stand */ }
  return { width, height, dominantColors: colors, caption, kind };
}
