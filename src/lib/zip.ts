import { zipSync } from "fflate";

/** Zips in-memory files (deflate level 6). Names may contain `/` to create folders. */
export function zipFiles(files: { name: string; data: Buffer }[]): Buffer {
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) entries[f.name] = new Uint8Array(f.data);
  return Buffer.from(zipSync(entries, { level: 6 }));
}
