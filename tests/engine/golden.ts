import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

const DIR = path.join(__dirname, "__golden__");

/** Compare `actual` (PNG buffer) with the stored golden. Creates it if missing or UPDATE_GOLDEN=1. Returns mismatched pixel ratio. */
export function expectGolden(name: string, actual: Buffer, maxRatio = 0.002) {
  mkdirSync(DIR, { recursive: true });
  const file = path.join(DIR, `${name}.png`);
  if (!existsSync(file) || process.env.UPDATE_GOLDEN === "1") {
    writeFileSync(file, actual);
    return;
  }
  const a = PNG.sync.read(actual), g = PNG.sync.read(readFileSync(file));
  if (a.width !== g.width || a.height !== g.height) throw new Error(`${name}: size ${a.width}x${a.height} != golden ${g.width}x${g.height}`);
  const diff = new PNG({ width: a.width, height: a.height });
  const bad = pixelmatch(a.data, g.data, diff.data, a.width, a.height, { threshold: 0.1 });
  const ratio = bad / (a.width * a.height);
  if (ratio > maxRatio) {
    writeFileSync(path.join(DIR, `${name}.diff.png`), PNG.sync.write(diff));
    throw new Error(`${name}: ${(ratio * 100).toFixed(3)}% pixels differ (see ${name}.diff.png)`);
  }
}
