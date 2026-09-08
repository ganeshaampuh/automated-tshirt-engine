import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { expand, type Set, type TextMeasurer } from "@/engine";
import { exportPrintPng, renderMockup, loadShirtAsset, defaultShirtFor, type RenderOpts } from "@/engine/server";
import { zipFiles } from "./zip";

export type ClipartSize = { w: number; h: number };
export type ExportDeps = { measure: TextMeasurer; clipartSize: ClipartSize; loadImage: RenderOpts["loadImage"] };

/** Filesystem/zip-safe slug that keeps non-ASCII letters (Indonesian names). */
const slug = (s: string) => s.trim().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");

export function buildDesigns(set: Set, measure: TextMeasurer, clipartSize: ClipartSize) {
  return expand(set, { measure, clipart: clipartSize });
}

/** Reads bytes for a local path, a `data:` URL or an http(s) URL. */
export async function fetchBytes(src: string): Promise<Buffer> {
  if (src.startsWith("data:")) return Buffer.from(src.slice(src.indexOf(",") + 1), "base64");
  if (/^https?:/.test(src)) {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`Failed to fetch ${src}: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  return readFile(src);
}

/** Intrinsic pixel size of the clipart, which `expand` needs to keep its aspect ratio. */
export async function clipartSize(src: string): Promise<ClipartSize> {
  const { width, height } = await sharp(await fetchBytes(src)).metadata();
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
  for (const { memberId, design } of buildDesigns(set, deps.measure, deps.clipartSize)) {
    const member = set.input.members.find(m => m.id === memberId);
    if (!member) throw new Error(`Unknown member ${memberId}`);
    const base = `${slug(set.input.kidName)}-${slug(member.label)}`;
    const print = await exportPrintPng(design, deps.loadImage);
    files.push({ name: `${base}.png`, data: print.png });
    sizes[memberId] = { widthCm: print.widthCm, heightCm: print.heightCm };
    const shirt = await loadShirtAsset(defaultShirtFor(design.sizeClass));
    files.push({ name: `${base}.mockup.jpg`, data: await renderMockup(design, shirt, { loadImage: deps.loadImage, width: 2000 }) });
  }
  return { zip: zipFiles(files), sizes };
}
