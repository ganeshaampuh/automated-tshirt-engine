import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Every module reachable from src/engine/index.ts must be free of Node/native imports.
const ROOT = path.join(process.cwd(), "src", "engine");
const BANNED = [/from\s+["']node:/, /from\s+["']@napi-rs\/canvas["']/, /from\s+["']sharp["']/, /from\s+["']fs["']/, /from\s+["']path["']/];

function imports(file: string): string[] {
  const src = readFileSync(file, "utf8");
  return [...src.matchAll(/from\s+["'](\.[^"']+)["']/g)].map(m => m[1]);
}
function resolve(from: string, spec: string) {
  const base = path.resolve(path.dirname(from), spec);
  for (const c of [base + ".ts", base + ".tsx", path.join(base, "index.ts")]) { try { readFileSync(c); return c; } catch {} }
  throw new Error(`cannot resolve ${spec} from ${from}`);
}
function walk(file: string, seen = new Set<string>()): Set<string> {
  if (seen.has(file)) return seen;
  seen.add(file);
  for (const spec of imports(file)) walk(resolve(file, spec), seen);
  return seen;
}

describe("@/engine is isomorphic", () => {
  it("reaches no node-only module", () => {
    const files = [...walk(path.join(ROOT, "index.ts"))];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const re of BANNED) expect(src, `${path.relative(ROOT, f)} matches ${re}`).not.toMatch(re);
    }
    expect(files.some(f => f.endsWith("render/server.ts"))).toBe(false);
    expect(files.some(f => f.endsWith("mockup.ts"))).toBe(false);
  });
  it("@/engine/server exposes the node surface", async () => {
    const s = await import("@/engine/server");
    for (const n of ["createNodeMeasurer", "renderDesign", "exportPrintPng", "renderMockup", "loadShirtAsset", "fontFilePath", "registerFonts"]) expect(s).toHaveProperty(n);
  });
});
