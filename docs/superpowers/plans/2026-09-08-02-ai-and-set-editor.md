# AI Services + Set Editor Implementation Plan (Plan 2 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working web UI where a user creates a family birthday set, gets AI-generated clipart and style from Z.ai, edits it on a Konva canvas over a shirt mockup, and exports a ZIP of print PNGs, with sets persisted in Postgres and files in Blob.

**Architecture:** The engine from plan 1 is split into an isomorphic entry (`@/engine`) the browser can import and a server entry (`@/engine/server`). A Konva renderer implements the same text rules as the server renderer, verified by a Playwright parity test. `src/ai` wraps Z.ai behind a small provider interface with Zod-validated outputs and code fallbacks. `src/db` (Drizzle + Neon) stores sets; `@vercel/blob` stores clipart and exports. Server actions glue the editor page to the engine, AI, DB, and Blob.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, Playwright, Zod, `konva` + `react-konva`, Drizzle ORM + `@neondatabase/serverless`, `@vercel/blob`, `fflate` (ZIP), `sharp`, `@napi-rs/canvas`. Z.ai via plain `fetch` (OpenAI-compatible endpoint).

**Spec:** `docs/superpowers/specs/2026-09-08-tshirt-design-generator-design.md` (§3, §4, §5, §6, §7, §8.1, §9, §10, §11)

## Global Constraints

- Everything importable from `@/engine` must be safe in the browser: no `node:*`, no `@napi-rs/canvas`, no `sharp`, no `fs`. Server-only engine code lives under `@/engine/server`.
- The browser renderer must follow the server text rules exactly: `textBaseline = "top"`, stroke under fill, `lineJoin = "round"`, visible outline width = `stroke.width`, `x` is the left edge of the `maxWidth` box and `align` positions within it, `transform: "upper"` uppercases before measure and draw, `rotation` around the box center.
- Print resolution 300 DPI; canvas square `maxPx(sizeClass)`: adult 3425 (29 cm), kids-0-1 2126 (18 cm), kids-1-9 2362 (20 cm); 3% safe inset; export cropped to bbox + 1% margin.
- Layer ids are `numeral, clipart, top, ordinal, occasion, bottom`; member overrides are keyed by them.
- AI outputs are Zod-validated; on failure retry once with the error appended, then fall back to code defaults and set `aiFallback = true`. A set must never fail solely because the LLM misbehaved.
- Z.ai model ids live only in `src/ai/config.ts`. Env: `ZAI_API_KEY`, `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`. Never log secrets.
- Uploaded/generated clipart is stored in Blob with `access: "public"`; export ZIPs too (URLs are unguessable).
- Commit after every task with a conventional-commit message.

---

## File structure

```
src/engine/index.ts            isomorphic barrel (types, sizing, fonts registry, text, textFit, wording, collage, expand)
src/engine/server.ts           server barrel (measure, render/server, exportPng, mockup, fonts.node)
src/engine/fonts.ts            registry only (pure)          src/engine/fonts.node.ts  fontFilePath, registerFonts
src/engine/render/browser/     Konva renderer: DesignStage.tsx, useBrowserMeasurer.ts, fontFaces.ts
src/ai/config.ts               model ids + base URL          src/ai/provider.ts       AIProvider interface + ZaiProvider
src/ai/clipart.ts              generateClipart, describeClipart   src/ai/style.ts   chooseStyle (+ fallback)
src/db/schema.ts, src/db/index.ts, drizzle.config.ts, drizzle/ (migrations)
src/lib/blob.ts                putBlob helper                 src/lib/zip.ts     zipFiles
src/app/actions/sets.ts        server actions                 src/app/set/[id]/page.tsx + components/
src/app/page.tsx               home: new set / recent sets    src/app/fonts.css
tests/ai/*.test.ts, tests/db/*.test.ts, tests/engine/bounds.test.ts, e2e/parity.spec.ts
```

---

### Task 1: Split the engine into isomorphic and server entry points

**Files:**
- Modify: `src/engine/index.ts`, `src/engine/fonts.ts`, `src/engine/measure.ts`, `src/engine/README.md`, `tests/engine/smoke.test.ts`, `tests/engine/fonts.test.ts`
- Create: `src/engine/server.ts`, `src/engine/fonts.node.ts`, `tests/engine/isomorphic.test.ts`

**Interfaces:**
- Produces: `@/engine` exports `ENGINE_VERSION`, all of `types`, `sizing`, `FONT_REGISTRY`, `CURATED_FONTS`, `DEFAULT_FONT`, `displayText`, `fitText`, `type TextMeasurer`, `defaultWording`, `ordinalSuffix`, `resolveLines`, `collage`, `type TemplateContext`, `expand`, `applyOverrides`. `@/engine/server` exports `createNodeMeasurer`, `ensureNodeFonts`, `renderDesign`, `loadImageFromFile`, `type RenderOpts`, `exportPrintPng`, `ExportError`, `renderMockup`, `loadShirtAsset`, `defaultShirtFor`, `type ShirtAsset`, `ShirtAssetSchema`, `fontFilePath`, `registerFonts`.
- `TextMeasurer` interface moves to `src/engine/textFit.ts` (pure); `measure.ts` imports it from there.

- [ ] **Step 1: Write the isomorphic guard test**

`tests/engine/isomorphic.test.ts`:
```ts
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
```

- [ ] **Step 2: Run, expect fail** — `pnpm test tests/engine/isomorphic.test.ts` → FAIL (index reaches render/server, fonts imports node:path, `@/engine/server` missing).

- [ ] **Step 3: Split fonts**

`src/engine/fonts.ts` (pure):
```ts
export const FONT_REGISTRY: Record<string, { file: string; weights: number[] }> = {
  "Fredoka":      { file: "Fredoka.ttf",     weights: [400, 700] },
  "Baloo 2":      { file: "Baloo2.ttf",      weights: [400, 700, 900] },
  "Chewy":        { file: "Chewy.ttf",       weights: [400] },
  "Bangers":      { file: "Bangers.ttf",     weights: [400] },
  "Lilita One":   { file: "LilitaOne.ttf",   weights: [400] },
  "Luckiest Guy": { file: "LuckiestGuy.ttf", weights: [400] },
};
export const CURATED_FONTS = Object.keys(FONT_REGISTRY);
export const DEFAULT_FONT = "Fredoka";
/** URL path the browser loads a font from (served from public/). */
export const fontUrl = (family: string) => {
  const e = FONT_REGISTRY[family];
  if (!e) throw new Error(`Unknown font family: ${family}`);
  return `/fonts/${e.file}`;
};
```

`src/engine/fonts.node.ts`:
```ts
import path from "node:path";
import { FONT_REGISTRY, CURATED_FONTS } from "./fonts";

export function fontFilePath(family: string): string {
  const entry = FONT_REGISTRY[family];
  if (!entry) throw new Error(`Unknown font family: ${family}`);
  return path.join(process.cwd(), "public", "fonts", entry.file);
}
export function registerFonts(register: (filePath: string, family: string) => void): void {
  for (const family of CURATED_FONTS) register(fontFilePath(family), family);
}
```
Update `src/engine/measure.ts` to import `registerFonts` from `./fonts.node` and `TextMeasurer` from `./textFit`; move the `TextMeasurer` interface into `textFit.ts` (delete the type re-export there). Update `tests/engine/fonts.test.ts` imports (`fontFilePath`, `registerFonts` from `@/engine/fonts.node`).

- [ ] **Step 4: Write the two barrels**

`src/engine/index.ts`:
```ts
export const ENGINE_VERSION = 2 as const;
export * from "./types";
export * from "./sizing";
export * from "./fonts";
export { displayText } from "./text";
export { fitText, type TextMeasurer } from "./textFit";
export { defaultWording, ordinalSuffix, resolveLines } from "./wording";
export { collage, type TemplateContext } from "./templates/collage";
export { expand, applyOverrides } from "./expand";
```
`src/engine/server.ts`:
```ts
export { createNodeMeasurer, ensureNodeFonts } from "./measure";
export { renderDesign, loadImageFromFile, type RenderOpts } from "./render/server";
export { exportPrintPng, ExportError } from "./exportPng";
export { renderMockup, loadShirtAsset, defaultShirtFor, type ShirtAsset, ShirtAssetSchema } from "./mockup";
export { fontFilePath, registerFonts } from "./fonts.node";
```
Remove `displayText` re-export from `render/server.ts` (import it from `../text` there). Update `tests/engine/smoke.test.ts` to check the isomorphic list on `@/engine` and the server list on `@/engine/server`. Fix every test import that used a server name from `@/engine`.

- [ ] **Step 5: Run everything** — `pnpm test && pnpm tsc --noEmit && pnpm lint` → green.

- [ ] **Step 6: README** — replace the "server-only barrel" note with the two-entry-point rule and the browser rule (fonts via `fontUrl`, measuring via the browser measurer from Task 3).

- [ ] **Step 7: Commit** — `git commit -m "refactor(engine): split isomorphic and server entry points"`

---

### Task 2: Ink-aware layer bounds and template slack

**Files:**
- Modify: `src/engine/sizing.ts`, `src/engine/templates/collage.ts`, `tests/engine/sizing.test.ts`, `tests/engine/collage.test.ts`, goldens
- Create: `tests/engine/bounds.test.ts`

**Interfaces:**
- Produces: `layerBounds(layer)` for text = `{ x: x - s, y: y - s, w: maxWidth + 2s, h: size * lines * 1.25 + 2s }` where `s = stroke?.width ?? 0` (1.25 = descender allowance). Image bounds unchanged. `DESCENDER_RATIO = 0.25` exported.

- [ ] **Step 1: Failing tests**

`tests/engine/bounds.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { layerBounds, DESCENDER_RATIO } from "@/engine";
import type { TextLayer } from "@/engine";

const t: TextLayer = { id: "t", type: "text", text: "Ayah", font: "Fredoka", weight: 700, size: 100, color: "#000000", align: "center", x: 100, y: 200, maxWidth: 400, lines: 1 };

describe("layerBounds (ink-aware)", () => {
  it("adds a descender allowance", () => {
    expect(layerBounds(t)).toEqual({ x: 100, y: 200, w: 400, h: 100 * (1 + DESCENDER_RATIO) });
  });
  it("expands by stroke width on every side", () => {
    expect(layerBounds({ ...t, stroke: { color: "#000000", width: 10 } })).toEqual({ x: 90, y: 190, w: 420, h: 125 + 20 });
  });
});
```
Also update the existing bounding-box expectation in `tests/engine/sizing.test.ts` (text layer at y 900, size 100 → bottom is now 1025).

- [ ] **Step 2: Run, expect fail.** `pnpm test tests/engine/bounds.test.ts tests/engine/sizing.test.ts`

- [ ] **Step 3: Implement in `src/engine/sizing.ts`**
```ts
export const DESCENDER_RATIO = 0.25;
export function layerBounds(l: Layer): Rect {
  if (l.type === "image") return { x: l.x, y: l.y, w: l.w, h: l.h };
  const s = l.stroke?.width ?? 0;
  return { x: l.x - s, y: l.y - s, w: l.maxWidth + 2 * s, h: l.size * (l.lines ?? 1) * (1 + DESCENDER_RATIO) + 2 * s };
}
```

- [ ] **Step 4: Retune the template so every slot has slack**

`pnpm test tests/engine/collage.test.ts` will now fail on the safe-area sweep (bottom slot, numeral stroke). In `collage.ts`: bottom slot `y = 0.80·S` with start size `0.14·S`; numeral `x = A.x + strokeWidth`, `y = 0.22·S` (0.26·S for id); top slot `y = A.y + 0.012·S` (stroke-free, but keep 1% air); the clamp loop uses `layerBounds` instead of `y + size`: `const b = layerBounds(t); if (b.y + b.h > A.y + A.h) t.y -= (b.y + b.h) - (A.y + A.h);`. Re-run until the sweep passes for all three size classes and both languages. Then `UPDATE_GOLDEN=1 pnpm test`, view `collage-en-ayah.png` and `mockup-ayah.png`, confirm nothing overlaps or clips, run `pnpm test` again for determinism.

- [ ] **Step 5: Add a slack assertion** to `tests/engine/collage.test.ts`: for every member/language, every text layer's ink bounds bottom is ≤ safe bottom (already implied) **and** `boundingBoxCm(d).longest <= maxCm(sizeClass)`.

- [ ] **Step 6: Commit** — `git commit -m "feat(engine): ink-aware bounds and template slack"`

---
### Task 3: Browser text measurer and font faces

**Files:**
- Create: `src/engine/render/browser/fontFaces.ts`, `src/engine/render/browser/useBrowserMeasurer.ts`, `src/app/fonts.css`
- Modify: `src/app/layout.tsx` (import `./fonts.css`)
- Test: `tests/engine/fontFaces.test.ts`

**Interfaces:**
- Produces: `fontFaceCss(): string` (one `@font-face` per registry family, `font-display: block`), `loadEngineFonts(): Promise<void>` (awaits `document.fonts.load` for every family/weight), `createBrowserMeasurer(): TextMeasurer` (OffscreenCanvas or a detached `<canvas>`; same `${weight} ${size}px "${font}"` font string and `(n-1) * letterSpacing` rule as the node measurer), hook `useBrowserMeasurer(): TextMeasurer | null` (null until fonts loaded).

- [ ] **Step 1: Failing test**

`tests/engine/fontFaces.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { fontFaceCss } from "@/engine/render/browser/fontFaces";
import { CURATED_FONTS } from "@/engine";

describe("fontFaceCss", () => {
  it("declares every curated family with display: block", () => {
    const css = fontFaceCss();
    for (const f of CURATED_FONTS) expect(css).toContain(`font-family: "${f}"`);
    expect(css.match(/@font-face/g)?.length).toBe(CURATED_FONTS.length);
    expect(css).toContain("font-display: block");
    expect(css).toContain("/fonts/Fredoka.ttf");
  });
});
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement**

`src/engine/render/browser/fontFaces.ts`:
```ts
import { CURATED_FONTS, FONT_REGISTRY, fontUrl } from "../../fonts";

export function fontFaceCss(): string {
  return CURATED_FONTS.map(f => {
    const w = FONT_REGISTRY[f].weights;
    const range = w.length > 1 ? `${Math.min(...w)} ${Math.max(...w)}` : String(w[0]);
    return `@font-face { font-family: "${f}"; src: url("${fontUrl(f)}") format("truetype"); font-weight: ${range}; font-display: block; }`;
  }).join("\n");
}

export async function loadEngineFonts(): Promise<void> {
  if (typeof document === "undefined") return;
  await Promise.all(CURATED_FONTS.flatMap(f => FONT_REGISTRY[f].weights.map(w => document.fonts.load(`${w} 32px "${f}"`))));
}
```
`src/engine/render/browser/useBrowserMeasurer.ts`:
```ts
"use client";
import { useEffect, useState } from "react";
import type { TextMeasurer } from "../../textFit";
import { loadEngineFonts } from "./fontFaces";

export function createBrowserMeasurer(): TextMeasurer {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  return {
    width(text, font, weight, size, letterSpacing = 0) {
      ctx.font = `${weight} ${size}px "${font}"`;
      return ctx.measureText(text).width + Math.max(0, text.length - 1) * letterSpacing;
    },
  };
}

export function useBrowserMeasurer(): TextMeasurer | null {
  const [m, setM] = useState<TextMeasurer | null>(null);
  useEffect(() => { let alive = true; loadEngineFonts().then(() => { if (alive) setM(createBrowserMeasurer()); }); return () => { alive = false; }; }, []);
  return m;
}
```
Generate `src/app/fonts.css` once with a tiny script step: `node -e "import('./src/engine/render/browser/fontFaces.ts')"` is awkward under Next; instead add `scripts/gen-font-css.ts` that writes `fontFaceCss()` to `src/app/fonts.css`, run it with `pnpm dlx tsx scripts/gen-font-css.ts`, commit the output, and import `./fonts.css` in `src/app/layout.tsx`.

- [ ] **Step 4: Run tests, tsc, lint → green. Commit** — `feat(engine): browser font faces and measurer`

---

### Task 4: Konva renderer with server parity test

**Files:**
- Create: `src/engine/render/browser/DesignStage.tsx`, `src/app/dev/parity/page.tsx`, `e2e/parity.spec.ts`, `playwright.config.ts`
- Modify: `package.json` (deps + `test:e2e` script), `next.config.ts` (nothing), `.gitignore` (`test-results/`)

**Interfaces:**
- Produces: `<DesignStage design scale selectedId onSelect onChange(layerId, patch) editable background?>` renders a `Design` with react-konva at `scale`; drag/resize emit `{ x, y }` / `{ x, y, w, h }` (image) or `{ x, y, maxWidth }` (text) patches in **print px**. `background` is a hex or `null` (transparent).

- [ ] **Step 1: Install** — `pnpm add konva react-konva && pnpm add -D @playwright/test && pnpm exec playwright install chromium`

- [ ] **Step 2: Implement `DesignStage.tsx`**

```tsx
"use client";
import { Stage, Layer, Image as KImage, Text as KText, Transformer, Rect } from "react-konva";
import { useEffect, useRef, useState } from "react";
import type Konva from "konva";
import type { Design, Layer as DLayer, TextLayer, ImageLayer } from "../../types";
import { displayText } from "../../text";

type Props = {
  design: Design; scale: number; background?: string | null; editable?: boolean;
  selectedId?: string | null; onSelect?: (id: string | null) => void;
  onChange?: (layerId: string, patch: Partial<TextLayer & ImageLayer>) => void;
};

function useHtmlImage(src: string) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => { const i = new window.Image(); i.crossOrigin = "anonymous"; i.onload = () => setImg(i); i.src = src; return () => { i.onload = null; }; }, [src]);
  return img;
}

function ImageNode({ l, editable, onChange, onSelect, nodeRef }: { l: ImageLayer; editable?: boolean; onChange?: Props["onChange"]; onSelect?: Props["onSelect"]; nodeRef: (n: Konva.Node | null) => void }) {
  const img = useHtmlImage(l.src);
  if (!img) return null;
  return (
    <KImage ref={nodeRef} id={l.id} image={img} x={l.x} y={l.y} width={l.w} height={l.h} rotation={l.rotation ?? 0}
      offsetX={0} offsetY={0} draggable={editable}
      onClick={() => onSelect?.(l.id)} onTap={() => onSelect?.(l.id)}
      onDragEnd={e => onChange?.(l.id, { x: e.target.x(), y: e.target.y() })}
      onTransformEnd={e => { const n = e.target; const w = n.width() * n.scaleX(), h = n.height() * n.scaleY(); n.scaleX(1); n.scaleY(1); onChange?.(l.id, { x: n.x(), y: n.y(), w, h, rotation: n.rotation() }); }} />
  );
}

function TextNode({ l, editable, onChange, onSelect, nodeRef }: { l: TextLayer; editable?: boolean; onChange?: Props["onChange"]; onSelect?: Props["onSelect"]; nodeRef: (n: Konva.Node | null) => void }) {
  return (
    <KText ref={nodeRef} id={l.id} text={displayText(l)} x={l.x} y={l.y} width={l.maxWidth} align={l.align}
      fontFamily={l.font} fontStyle={l.weight >= 700 ? "bold" : "normal"} fontSize={l.size} letterSpacing={l.letterSpacing ?? 0}
      fill={l.color} stroke={l.stroke?.color} strokeWidth={l.stroke ? l.stroke.width * 2 : 0} fillAfterStrokeEnabled lineJoin="round"
      shadowColor={l.shadow?.color} shadowBlur={l.shadow?.blur ?? 0} shadowOffsetX={l.shadow?.dx ?? 0} shadowOffsetY={l.shadow?.dy ?? 0} shadowEnabled={!!l.shadow}
      shadowForStrokeEnabled={!!l.shadow} rotation={l.rotation ?? 0} wrap="none" verticalAlign="top" draggable={editable}
      onClick={() => onSelect?.(l.id)} onTap={() => onSelect?.(l.id)}
      onDragEnd={e => onChange?.(l.id, { x: e.target.x(), y: e.target.y() })}
      onTransformEnd={e => { const n = e.target as Konva.Text; const maxWidth = n.width() * n.scaleX(); n.scaleX(1); n.scaleY(1); onChange?.(l.id, { x: n.x(), y: n.y(), maxWidth, rotation: n.rotation() }); }} />
  );
}

export function DesignStage({ design, scale, background = null, editable, selectedId, onSelect, onChange }: Props) {
  const nodes = useRef(new Map<string, Konva.Node>());
  const trRef = useRef<Konva.Transformer>(null);
  useEffect(() => {
    const tr = trRef.current; if (!tr) return;
    const n = selectedId ? nodes.current.get(selectedId) : undefined;
    tr.nodes(n ? [n] : []); tr.getLayer()?.batchDraw();
  }, [selectedId, design]);
  const W = design.canvas.w * scale, H = design.canvas.h * scale;
  return (
    <Stage width={W} height={H} scaleX={scale} scaleY={scale} onMouseDown={e => { if (e.target === e.target.getStage()) onSelect?.(null); }}>
      <Layer>
        {background && <Rect x={0} y={0} width={design.canvas.w} height={design.canvas.h} fill={background} listening={false} />}
        {design.layers.map((l: DLayer) => {
          const ref = (n: Konva.Node | null) => { if (n) nodes.current.set(l.id, n); else nodes.current.delete(l.id); };
          return l.type === "image"
            ? <ImageNode key={l.id} l={l} editable={editable} onChange={onChange} onSelect={onSelect} nodeRef={ref} />
            : <TextNode key={l.id} l={l} editable={editable} onChange={onChange} onSelect={onSelect} nodeRef={ref} />;
        })}
        {editable && <Transformer ref={trRef} rotateEnabled keepRatio enabledAnchors={["top-left", "top-right", "bottom-left", "bottom-right"]} />}
      </Layer>
    </Stage>
  );
}
```
Note on parity: Konva's `Text` draws from the top (equivalent to `textBaseline = "top"`), `fillAfterStrokeEnabled` gives stroke-under-fill, and `strokeWidth = 2 * stroke.width` matches the server's doubled `lineWidth`. Konva applies rotation around the node origin, not the box center; for parity set `offsetX = maxWidth/2, offsetY = size*lines/2` and `x = l.x + offsetX, y = l.y + offsetY` on both node types when `rotation` is non-zero (implement this in both nodes and reverse it in the drag/transform handlers).

- [ ] **Step 3: Parity dev page**

`src/app/dev/parity/page.tsx` (client component): reads `?member=ayah&lang=en`, builds the unicorn fixture set (import `unicornSet` from a new `src/lib/fixtures/unicornSet.ts` that mirrors `tests/fixtures/set-unicorn.ts` but with `clipartSrc: "/samples/unicorn.png"`; copy `tests/fixtures/unicorn.png` to `public/samples/unicorn.png`), waits for `useBrowserMeasurer()`, runs `collage`, and renders `<DesignStage design scale={0.2} />` inside a `<div data-testid="stage">`. Guard the route so it 404s in production (`if (process.env.NODE_ENV === "production") notFound()`).

- [ ] **Step 4: Playwright parity spec**

`playwright.config.ts`: `webServer: { command: "pnpm dev", url: "http://localhost:3000", reuseExistingServer: true }`, `testDir: "e2e"`. `e2e/parity.spec.ts`:
```ts
import { test, expect } from "@playwright/test";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { readFileSync } from "node:fs";

for (const m of ["ayah", "kid"]) test(`browser render matches server golden (${m})`, async ({ page }) => {
  await page.goto(`/dev/parity?member=${m}&lang=en`);
  await page.waitForSelector('[data-testid="stage"] canvas');
  await page.waitForTimeout(500);
  const shot = PNG.sync.read(await page.locator('[data-testid="stage"] canvas').first().screenshot({ omitBackground: true }));
  const gold = PNG.sync.read(readFileSync(`tests/engine/__golden__/collage-en-${m}.png`));
  expect(shot.width).toBe(gold.width);
  const diff = new PNG({ width: gold.width, height: gold.height });
  const bad = pixelmatch(shot.data, gold.data, diff.data, gold.width, gold.height, { threshold: 0.2 });
  expect(bad / (gold.width * gold.height)).toBeLessThan(0.03); // 3%: antialiasing differs between skia and Chrome
});
```
Add `"test:e2e": "playwright test"` to package.json. Run: `pnpm test:e2e`. If the ratio is above 3%, save `diff` to `test-results/` and inspect: the usual culprits are font weight synthesis (Fredoka variable font → set `fontStyle="bold"` only if weight ≥ 700 and register weight 700 in `fonts.css`), letterSpacing, and the rotation offset. Fix the renderer, never loosen beyond 5%.

- [ ] **Step 5: Commit** — `feat(engine): konva renderer with parity test`

---

### Task 5: Database and Blob

**Files:**
- Create: `src/db/schema.ts`, `src/db/index.ts`, `drizzle.config.ts`, `drizzle/0000_init.sql` (generated), `src/lib/blob.ts`, `.env.example`
- Modify: `package.json` scripts (`db:generate`, `db:migrate`, `db:studio`)
- Test: `tests/db/schema.test.ts`

**Interfaces:**
- Produces: tables `sets` and `batches` (batches unused until plan 3 but created now to avoid a second migration): 
  ```ts
  sets: { id: uuid pk, batchId: uuid null, status: text ('draft'|'queued'|'processing'|'ready'|'approved'|'rejected'|'failed'), input: jsonb (SetInput), style: jsonb (SetStyle) null, aiFallback: boolean default false, error: text null, previewUrls: jsonb ({[memberId]: url}) null, exportUrl: text null, createdAt, updatedAt }
  batches: { id uuid pk, name text, status text, setCount int, readyCount int, approvedCount int, failedCount int, csvUrl text, zipUrl text null, createdAt, updatedAt }
  ```
  `db` (drizzle client over `@neondatabase/serverless` `neon(process.env.DATABASE_URL)`), `putBlob(path: string, body: Buffer | Blob, contentType: string): Promise<string>` returning the public URL.

- [ ] **Step 1: Provision Neon and Blob via the Vercel Marketplace.** Use the `vercel:marketplace` skill: run its discover step, provision Neon Postgres and Vercel Blob for project `automated-tshirt-engine` (team `ganeshaampuh`), then `vercel env pull .env.local --yes`. Confirm `DATABASE_URL` and `BLOB_READ_WRITE_TOKEN` exist by name only (`grep -E "^(DATABASE_URL|BLOB_READ_WRITE_TOKEN)=" .env.local | cut -d= -f1`). Create `.env.example` listing `DATABASE_URL=`, `BLOB_READ_WRITE_TOKEN=`, `ZAI_API_KEY=`.

- [ ] **Step 2: Install** — `pnpm add drizzle-orm @neondatabase/serverless @vercel/blob && pnpm add -D drizzle-kit dotenv`

- [ ] **Step 3: Schema + client**

`src/db/schema.ts`:
```ts
import { pgTable, uuid, text, jsonb, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import type { SetInput, SetStyle } from "@/engine";

export const sets = pgTable("sets", {
  id: uuid("id").primaryKey().defaultRandom(),
  batchId: uuid("batch_id"),
  status: text("status").notNull().default("draft"),
  input: jsonb("input").$type<SetInput>().notNull(),
  style: jsonb("style").$type<SetStyle>(),
  aiFallback: boolean("ai_fallback").notNull().default(false),
  error: text("error"),
  previewUrls: jsonb("preview_urls").$type<Record<string, string>>(),
  exportUrl: text("export_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const batches = pgTable("batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  status: text("status").notNull().default("processing"),
  setCount: integer("set_count").notNull().default(0),
  readyCount: integer("ready_count").notNull().default(0),
  approvedCount: integer("approved_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  csvUrl: text("csv_url").notNull(),
  zipUrl: text("zip_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type SetRow = typeof sets.$inferSelect;
```
`src/db/index.ts`:
```ts
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
export const db = drizzle(neon(url), { schema });
export { schema };
```
`drizzle.config.ts`: `{ schema: "./src/db/schema.ts", out: "./drizzle", dialect: "postgresql", dbCredentials: { url: process.env.DATABASE_URL! } }` with `import "dotenv/config"` reading `.env.local` (`dotenv.config({ path: ".env.local" })`). Scripts: `"db:generate": "drizzle-kit generate"`, `"db:migrate": "drizzle-kit migrate"`, `"db:studio": "drizzle-kit studio"`.

`src/lib/blob.ts`:
```ts
import { put } from "@vercel/blob";
export async function putBlob(path: string, body: Buffer | Blob, contentType: string): Promise<string> {
  const { url } = await put(path, body, { access: "public", contentType, addRandomSuffix: true });
  return url;
}
```

- [ ] **Step 4: Migrate** — `pnpm db:generate && pnpm db:migrate`. Commit the generated SQL.

- [ ] **Step 5: Test** — `tests/db/schema.test.ts`: skip unless `DATABASE_URL` is set (`describe.skipIf(!process.env.DATABASE_URL)`); inserts a set with the unicorn fixture input, reads it back, asserts `input.kidName === "Keisya"` and `status === "draft"`, deletes it. Run with `pnpm dlx dotenv -e .env.local -- pnpm test tests/db`. Note in the README that DB tests need `.env.local`.

- [ ] **Step 6: Commit** — `feat(db): sets and batches schema, blob helper`

---
### Task 6: Z.ai provider

**Files:**
- Create: `src/ai/config.ts`, `src/ai/provider.ts`, `src/ai/index.ts`
- Test: `tests/ai/provider.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface AIProvider {
    chatJSON<T>(opts: { system: string; user: string; schema: ZodType<T>; images?: string[] }): Promise<T>;
    generateImage(opts: { prompt: string; size?: string }): Promise<Buffer>;
  }
  class ZaiProvider implements AIProvider { constructor(opts: { apiKey: string; fetch?: typeof fetch }) }
  class AIError extends Error { constructor(message, public readonly raw?: string) }
  getProvider(): AIProvider  // reads ZAI_API_KEY; throws a clear error if missing
  ```
- `src/ai/config.ts`: `ZAI_BASE_URL = "https://api.z.ai/api/paas/v4"`, `MODELS = { text: "glm-4.5", vision: "glm-4.5v", image: "cogview-4-250304" }`. If Z.ai has renamed a model when you run this, update only this file.

- [ ] **Step 1: Failing tests (mocked fetch)**

`tests/ai/provider.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { ZaiProvider, AIError } from "@/ai/provider";
import { MODELS, ZAI_BASE_URL } from "@/ai/config";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("ZaiProvider.chatJSON", () => {
  it("posts to chat/completions with json mode and parses the schema", async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe(`${ZAI_BASE_URL}/chat/completions`);
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe(MODELS.text);
      expect(body.response_format).toEqual({ type: "json_object" });
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k");
      return ok({ choices: [{ message: { content: '{"font":"Fredoka"}' } }] });
    });
    const p = new ZaiProvider({ apiKey: "k", fetch: fetchMock as unknown as typeof fetch });
    const out = await p.chatJSON({ system: "s", user: "u", schema: z.object({ font: z.string() }) });
    expect(out).toEqual({ font: "Fredoka" });
  });

  it("uses the vision model when images are given", async () => {
    const fetchMock = vi.fn(async (_u: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe(MODELS.vision);
      expect(body.messages[1].content[0]).toEqual({ type: "image_url", image_url: { url: "https://x/y.png" } });
      return ok({ choices: [{ message: { content: '{"kind":"illustration"}' } }] });
    });
    const p = new ZaiProvider({ apiKey: "k", fetch: fetchMock as unknown as typeof fetch });
    await p.chatJSON({ system: "s", user: "u", images: ["https://x/y.png"], schema: z.object({ kind: z.string() }) });
  });

  it("strips ```json fences and throws AIError with raw text on schema failure", async () => {
    const fetchMock = vi.fn(async () => ok({ choices: [{ message: { content: "```json\n{\"font\":42}\n```" } }] }));
    const p = new ZaiProvider({ apiKey: "k", fetch: fetchMock as unknown as typeof fetch });
    await expect(p.chatJSON({ system: "s", user: "u", schema: z.object({ font: z.string() }) })).rejects.toBeInstanceOf(AIError);
  });

  it("throws AIError on non-2xx", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 429 }));
    const p = new ZaiProvider({ apiKey: "k", fetch: fetchMock as unknown as typeof fetch });
    await expect(p.chatJSON({ system: "s", user: "u", schema: z.object({}) })).rejects.toThrow(/429/);
  });
});

describe("ZaiProvider.generateImage", () => {
  it("posts to images/generations and downloads the returned url", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/images/generations")) return ok({ data: [{ url: "https://cdn/x.png" }] });
      if (url === "https://cdn/x.png") return new Response(png, { status: 200 });
      throw new Error("unexpected " + url);
    });
    const p = new ZaiProvider({ apiKey: "k", fetch: fetchMock as unknown as typeof fetch });
    const out = await p.generateImage({ prompt: "unicorn" });
    expect(Buffer.compare(out, png)).toBe(0);
  });
});
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement**

`src/ai/config.ts`:
```ts
export const ZAI_BASE_URL = "https://api.z.ai/api/paas/v4";
export const MODELS = { text: "glm-4.5", vision: "glm-4.5v", image: "cogview-4-250304" } as const;
```
`src/ai/provider.ts`:
```ts
import type { ZodType } from "zod";
import { MODELS, ZAI_BASE_URL } from "./config";

export class AIError extends Error { constructor(message: string, public readonly raw?: string) { super(message); } }

export interface AIProvider {
  chatJSON<T>(opts: { system: string; user: string; schema: ZodType<T>; images?: string[] }): Promise<T>;
  generateImage(opts: { prompt: string; size?: string }): Promise<Buffer>;
}

const stripFences = (s: string) => s.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();

export class ZaiProvider implements AIProvider {
  private readonly fetchFn: typeof fetch;
  constructor(private readonly opts: { apiKey: string; fetch?: typeof fetch }) { this.fetchFn = opts.fetch ?? fetch; }

  private async post(path: string, body: unknown): Promise<unknown> {
    const res = await this.fetchFn(`${ZAI_BASE_URL}${path}`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.opts.apiKey}` }, body: JSON.stringify(body),
    });
    if (!res.ok) throw new AIError(`Z.ai ${path} failed with ${res.status}`, await res.text().catch(() => undefined));
    return res.json();
  }

  async chatJSON<T>({ system, user, schema, images }: { system: string; user: string; schema: ZodType<T>; images?: string[] }): Promise<T> {
    const content = images?.length ? [...images.map(url => ({ type: "image_url", image_url: { url } })), { type: "text", text: user }] : user;
    const json = (await this.post("/chat/completions", {
      model: images?.length ? MODELS.vision : MODELS.text, temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content }],
    })) as { choices?: { message?: { content?: string } }[] };
    const raw = json.choices?.[0]?.message?.content ?? "";
    let parsed: unknown;
    try { parsed = JSON.parse(stripFences(raw)); } catch { throw new AIError("Z.ai returned non-JSON", raw); }
    const r = schema.safeParse(parsed);
    if (!r.success) throw new AIError(`Z.ai JSON failed validation: ${r.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ")}`, raw);
    return r.data;
  }

  async generateImage({ prompt, size = "1024x1024" }: { prompt: string; size?: string }): Promise<Buffer> {
    const json = (await this.post("/images/generations", { model: MODELS.image, prompt, size })) as { data?: { url?: string; b64_json?: string }[] };
    const d = json.data?.[0];
    if (d?.b64_json) return Buffer.from(d.b64_json, "base64");
    if (!d?.url) throw new AIError("Z.ai image response had no url", JSON.stringify(json));
    const img = await this.fetchFn(d.url);
    if (!img.ok) throw new AIError(`Downloading generated image failed with ${img.status}`);
    return Buffer.from(await img.arrayBuffer());
  }
}

let cached: AIProvider | undefined;
export function getProvider(): AIProvider {
  if (cached) return cached;
  const apiKey = process.env.ZAI_API_KEY;
  if (!apiKey) throw new AIError("ZAI_API_KEY is not set");
  return (cached = new ZaiProvider({ apiKey }));
}
export function setProviderForTests(p: AIProvider | undefined) { cached = p; }
```
`src/ai/index.ts` re-exports provider, config, and (after Tasks 7–8) clipart and style.

- [ ] **Step 4: Run, expect pass; tsc; commit** — `feat(ai): z.ai provider`

---

### Task 7: Clipart generation and description

**Files:**
- Create: `src/ai/clipart.ts`, `src/ai/prompts.ts`
- Test: `tests/ai/clipart.test.ts`

**Interfaces:**
- Produces:
  ```ts
  generateClipart(theme: string, deps: { provider: AIProvider; putBlob: (path, body, type) => Promise<string> }): Promise<{ url: string; width: number; height: number }>
  describeClipart(src: string | Buffer, deps: { provider: AIProvider }): Promise<ClipartMeta>
  type ClipartMeta = { width: number; height: number; dominantColors: string[]; caption: string; kind: "photo" | "illustration" | "logo" | "pattern" }
  removeWhiteBackground(png: Buffer): Promise<Buffer>   // near-white → transparent, then trim
  dominantColors(png: Buffer, n = 5): Promise<string[]>  // hex, most frequent first, ignoring transparent and near-white
  ```

- [ ] **Step 1: Failing tests**

`tests/ai/clipart.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { generateClipart, describeClipart, removeWhiteBackground, dominantColors } from "@/ai/clipart";
import type { AIProvider } from "@/ai/provider";

const unicorn = readFileSync("tests/fixtures/unicorn.png");

describe("removeWhiteBackground", () => {
  it("turns a white border transparent and trims", async () => {
    const src = await sharp({ create: { width: 200, height: 200, channels: 4, background: "#ffffff" } })
      .composite([{ input: await sharp({ create: { width: 50, height: 80, channels: 4, background: "#ff0000" } }).png().toBuffer(), left: 75, top: 60 }]).png().toBuffer();
    const out = await removeWhiteBackground(src);
    const meta = await sharp(out).metadata();
    expect(meta.width).toBeLessThanOrEqual(52); expect(meta.height).toBeLessThanOrEqual(82);
    const { data } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    expect(data[3]).toBe(255); // top-left after trim is red, opaque
  });
});

describe("dominantColors", () => {
  it("finds pinks in the unicorn fixture and ignores white/transparent", async () => {
    const cols = await dominantColors(unicorn, 5);
    expect(cols.length).toBeGreaterThan(0);
    for (const c of cols) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    expect(cols).not.toContain("#ffffff");
  });
});

describe("generateClipart", () => {
  it("augments the prompt, post-processes, uploads, returns url + size", async () => {
    const provider: AIProvider = {
      chatJSON: vi.fn(),
      generateImage: vi.fn(async ({ prompt }) => {
        expect(prompt).toContain("unicorn"); expect(prompt).toMatch(/plain white background/i); expect(prompt).toMatch(/no text/i);
        return sharp({ create: { width: 300, height: 300, channels: 4, background: "#ffffff" } })
          .composite([{ input: await sharp({ create: { width: 100, height: 60, channels: 4, background: "#00ff00" } }).png().toBuffer(), left: 100, top: 120 }]).png().toBuffer();
      }),
    };
    const putBlob = vi.fn(async (path: string) => { expect(path).toMatch(/^clipart\/.*\.png$/); return "https://blob/clipart.png"; });
    const out = await generateClipart("unicorn", { provider, putBlob });
    expect(out.url).toBe("https://blob/clipart.png");
    expect(out.width).toBeLessThanOrEqual(102); expect(out.height).toBeLessThanOrEqual(62);
  });
});

describe("describeClipart", () => {
  it("combines local metrics with the vision model", async () => {
    const provider: AIProvider = {
      generateImage: vi.fn(),
      chatJSON: vi.fn(async ({ images }) => { expect(images?.[0]).toMatch(/^data:image\/png;base64,/); return { caption: "a cute unicorn on a cloud", kind: "illustration" }; }),
    };
    const meta = await describeClipart(unicorn, { provider });
    expect(meta).toMatchObject({ width: 1000, height: 800, kind: "illustration" });
    expect(meta.dominantColors.length).toBeGreaterThan(0);
  });
  it("falls back to kind=illustration and an empty caption when the vision call fails", async () => {
    const provider: AIProvider = { generateImage: vi.fn(), chatJSON: vi.fn(async () => { throw new Error("down"); }) };
    const meta = await describeClipart(unicorn, { provider });
    expect(meta.kind).toBe("illustration"); expect(meta.caption).toBe("");
  });
});
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement**

`src/ai/prompts.ts`:
```ts
export const clipartPrompt = (theme: string) =>
  `cute flat vector-style ${theme}, single subject, centered, plain white background, no text, no letters, no watermark, thick outlines, pastel colors, kids t-shirt graphic`;
export const describeSystem = `You describe clipart for a kids t-shirt designer. Reply with JSON: {"caption": string (one sentence), "kind": "photo"|"illustration"|"logo"|"pattern"}.`;
```
`src/ai/clipart.ts`:
```ts
import sharp from "sharp";
import { z } from "zod";
import type { AIProvider } from "./provider";
import { clipartPrompt, describeSystem } from "./prompts";

export type ClipartMeta = { width: number; height: number; dominantColors: string[]; caption: string; kind: "photo" | "illustration" | "logo" | "pattern" };
const DescribeSchema = z.object({ caption: z.string(), kind: z.enum(["photo", "illustration", "logo", "pattern"]) });

/** Near-white (all channels ≥ 240) becomes transparent; then trim transparent borders. */
export async function removeWhiteBackground(png: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) if (data[i] >= 240 && data[i + 1] >= 240 && data[i + 2] >= 240) data[i + 3] = 0;
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).trim().png().toBuffer();
}

export async function dominantColors(png: Buffer, n = 5): Promise<string[]> {
  const { data } = await sharp(png).ensureAlpha().resize(64, 64, { fit: "inside" }).raw().toBuffer({ resolveWithObject: true });
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
  const png = await removeWhiteBackground(raw);
  const { width = 0, height = 0 } = await sharp(png).metadata();
  const url = await deps.putBlob(`clipart/${Date.now()}-${theme.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`, png, "image/png");
  return { url, width, height };
}

export async function describeClipart(src: string | Buffer, deps: { provider: AIProvider }): Promise<ClipartMeta> {
  const buf = Buffer.isBuffer(src) ? src : Buffer.from(await (await fetch(src)).arrayBuffer());
  const { width = 0, height = 0 } = await sharp(buf).metadata();
  const [colors, small] = await Promise.all([dominantColors(buf), sharp(buf).resize(512, 512, { fit: "inside" }).png().toBuffer()]);
  let caption = "", kind: ClipartMeta["kind"] = "illustration";
  try {
    const r = await deps.provider.chatJSON({ system: describeSystem, user: "Describe this image.", images: [`data:image/png;base64,${small.toString("base64")}`], schema: DescribeSchema });
    caption = r.caption; kind = r.kind;
  } catch { /* vision is best-effort; defaults stand */ }
  return { width, height, dominantColors: colors, caption, kind };
}
```

- [ ] **Step 4: Run, pass, tsc, commit** — `feat(ai): clipart generation and description`

---

### Task 8: Style selection with fallback

**Files:**
- Create: `src/ai/style.ts`
- Modify: `src/ai/prompts.ts`, `src/ai/index.ts`
- Test: `tests/ai/style.test.ts`

**Interfaces:**
- Produces:
  ```ts
  chooseStyle(input: SetInput, clipart: { url: string; meta: ClipartMeta }, deps: { provider: AIProvider }, note?: string): Promise<{ style: SetStyle; aiFallback: boolean; rationale: string }>
  fallbackStyle(input: SetInput, clipart): SetStyle        // deterministic: Fredoka, palette from dominant colors, default wording
  contrastRatio(a: hex, b: hex): number                   // WCAG
  ensureContrast(color: hex, against: hex, min = 3): hex  // darken/lighten until ratio ≥ min
  ```

- [ ] **Step 1: Failing tests**

`tests/ai/style.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { chooseStyle, fallbackStyle, contrastRatio, ensureContrast } from "@/ai/style";
import { unicornSet } from "../fixtures/set-unicorn";
import type { AIProvider } from "@/ai/provider";
import { AIError } from "@/ai/provider";

const input = unicornSet().input;
const clipart = { url: "https://blob/u.png", meta: { width: 1000, height: 800, dominantColors: ["#e6007e", "#f9a8d4", "#fde68a"], caption: "unicorn", kind: "illustration" as const } };
const good = { font: "Bangers", palette: { primary: "#e6007e", secondary: "#f9a8d4", outline: "#e6007e" }, rationale: "playful" };

describe("contrast helpers", () => {
  it("computes WCAG ratio", () => { expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0); });
  it("darkens a pale color on white until readable", () => {
    const c = ensureContrast("#f9a8d4", "#ffffff", 3);
    expect(contrastRatio(c, "#ffffff")).toBeGreaterThanOrEqual(3);
  });
});

describe("chooseStyle", () => {
  it("returns validated style from the model", async () => {
    const provider: AIProvider = { generateImage: vi.fn(), chatJSON: vi.fn(async () => good) };
    const r = await chooseStyle(input, clipart, { provider });
    expect(r.aiFallback).toBe(false); expect(r.style.font).toBe("Bangers"); expect(r.style.template).toBe("collage");
    expect(r.style.clipartSrc).toBe(clipart.url); expect(r.style.wording.occasion).toBe("Birthday");
  });
  it("retries once with the error, then falls back", async () => {
    const chat = vi.fn().mockRejectedValueOnce(new AIError("bad", "{}")).mockRejectedValueOnce(new AIError("bad again"));
    const provider: AIProvider = { generateImage: vi.fn(), chatJSON: chat };
    const r = await chooseStyle(input, clipart, { provider });
    expect(chat).toHaveBeenCalledTimes(2);
    expect((chat.mock.calls[1][0] as { user: string }).user).toMatch(/previous attempt failed/i);
    expect(r.aiFallback).toBe(true); expect(r.style.font).toBe("Fredoka"); expect(r.style.palette.primary).toMatch(/^#/);
  });
  it("rejects an uncurated font via schema and falls back", async () => {
    const provider: AIProvider = { generateImage: vi.fn(), chatJSON: vi.fn(async ({ schema }) => schema.parse({ ...good, font: "Comic Sans" })) };
    const r = await chooseStyle(input, clipart, { provider });
    expect(r.aiFallback).toBe(true);
  });
  it("enforces contrast against the shirt color", async () => {
    const provider: AIProvider = { generateImage: vi.fn(), chatJSON: vi.fn(async () => ({ ...good, palette: { primary: "#fefefe", secondary: "#f9a8d4", outline: "#fdfdfd" } })) };
    const r = await chooseStyle({ ...input, shirtColor: "#ffffff" }, clipart, { provider });
    expect(contrastRatio(r.style.palette.primary, "#ffffff")).toBeGreaterThanOrEqual(3);
  });
  it("appends the note on regenerate", async () => {
    const chat = vi.fn(async () => good);
    await chooseStyle(input, clipart, { provider: { generateImage: vi.fn(), chatJSON: chat } }, "lebih ceria");
    expect((chat.mock.calls[0][0] as { user: string }).user).toContain("lebih ceria");
  });
});
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement `src/ai/style.ts`**

```ts
import { z } from "zod";
import { CURATED_FONTS, DEFAULT_FONT, defaultWording, WordingSchema, type SetInput, type SetStyle } from "@/engine";
import type { AIProvider } from "./provider";
import type { ClipartMeta } from "./clipart";
import { styleSystem, styleUser } from "./prompts";

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const StyleChoice = z.object({
  font: z.enum(CURATED_FONTS as [string, ...string[]]),
  palette: z.object({ primary: Hex, secondary: Hex, outline: Hex }),
  wording: WordingSchema.partial().optional(),
  rationale: z.string().default(""),
});

const lum = (hex: string) => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const contrastRatio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const mix = (hex: string, t: number, toward: number) => "#" + [1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - t) + toward * t).toString(16).padStart(2, "0")).join("");
export function ensureContrast(color: string, against: string, min = 3): string {
  let c = color.toLowerCase();
  const toward = lum(against) > 0.5 ? 0 : 255;
  for (let i = 0; i < 20 && contrastRatio(c, against) < min; i++) c = mix(c, 0.1, toward);
  return c;
}

export function fallbackStyle(input: SetInput, clipart: { url: string; meta: ClipartMeta }): SetStyle {
  const [p = "#e6007e", s = "#f9a8d4"] = clipart.meta.dominantColors;
  const primary = ensureContrast(p, input.shirtColor);
  return { template: "collage", font: DEFAULT_FONT, palette: { primary, secondary: s, outline: primary }, clipartSrc: clipart.url, wording: defaultWording(input) };
}

export async function chooseStyle(input: SetInput, clipart: { url: string; meta: ClipartMeta }, deps: { provider: AIProvider }, note?: string) {
  const base = defaultWording(input);
  let user = styleUser(input, clipart.meta, note);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const c = await deps.provider.chatJSON({ system: styleSystem(CURATED_FONTS), user, schema: StyleChoice });
      const primary = ensureContrast(c.palette.primary, input.shirtColor);
      const style: SetStyle = { template: "collage", font: c.font, palette: { primary, secondary: c.palette.secondary, outline: ensureContrast(c.palette.outline, input.shirtColor) },
        clipartSrc: clipart.url, wording: { ...base, ...(c.wording ?? {}) } };
      return { style, aiFallback: false, rationale: c.rationale };
    } catch (e) {
      user += `\n\nThe previous attempt failed: ${(e as Error).message}. Return only valid JSON matching the schema.`;
    }
  }
  return { style: fallbackStyle(input, clipart), aiFallback: true, rationale: "AI unavailable; used defaults." };
}
```
Add to `src/ai/prompts.ts`:
```ts
export const styleSystem = (fonts: string[]) =>
  `You pick a visual style for a matching family birthday t-shirt set. Reply with JSON only:
{"font": one of ${JSON.stringify(fonts)}, "palette": {"primary": hex, "secondary": hex, "outline": hex}, "wording": optional {"kidTop","familyTop","ordinal","occasion"}, "rationale": one sentence}.
Rules: primary is the main text color and must contrast with the shirt; secondary is the big numeral fill (lighter tint of primary works well); outline is the numeral stroke; pick colors from or near the clipart's dominant colors; kids sets favour bold rounded fonts.`;
export const styleUser = (i: { kidName: string; age: number; theme: string; shirtColor: string; language: string }, m: { caption: string; kind: string; dominantColors: string[] }, note?: string) =>
  `Kid: ${i.kidName}, age ${i.age}. Theme: ${i.theme}. Language: ${i.language}. Shirt color: ${i.shirtColor}.
Clipart: ${m.caption || "(no caption)"} (${m.kind}); dominant colors: ${m.dominantColors.join(", ")}.${note ? `\nUser note: ${note}` : ""}`;
```
Export `WordingSchema` from `@/engine` if it is not already (it is via `export * from "./types"`).

- [ ] **Step 4: Run, pass, tsc, commit** — `feat(ai): style selection with contrast and fallback`

---
### Task 9: Server actions

**Files:**
- Create: `src/app/actions/sets.ts`, `src/lib/zip.ts`, `src/lib/sets.ts`
- Test: `tests/lib/sets.test.ts`, `tests/lib/zip.test.ts`

**Interfaces:**
- Produces (all `"use server"` in `sets.ts`, thin wrappers over pure functions in `src/lib/sets.ts` so they are testable without Next):
  ```ts
  createSet(input: SetInput): Promise<{ id: string }>
  saveSet(id: string, patch: { input?: SetInput; style?: SetStyle }): Promise<void>       // validates with Zod, bumps updatedAt
  generateClipartAction(id: string): Promise<{ url: string; width: number; height: number }>   // theme → Blob; stores clipartSrc on input + style
  uploadClipartAction(id: string, form: FormData): Promise<{ url; width; height }>             // file → removeWhiteBackground? NO: uploads are kept as-is, only trimmed
  generateStyleAction(id: string, note?: string): Promise<{ style: SetStyle; aiFallback: boolean; rationale: string }>
  exportSetAction(id: string): Promise<{ zipUrl: string; sizes: Record<string, { widthCm: number; heightCm: number }> }>
  ```
  `src/lib/sets.ts`: `buildDesigns(set: Set, measure, clipartSize) → { memberId, design }[]` (calls `expand`), `exportSetZip(set, deps) → { zip: Buffer; sizes }` (renders every member with `exportPrintPng` + a 2000 px mockup JPEG, names `${kidName}-${label}.png` / `.mockup.jpg`, zips with `fflate.zipSync`).
  `src/lib/zip.ts`: `zipFiles(files: { name: string; data: Buffer }[]): Buffer`.

- [ ] **Step 1: Install** — `pnpm add fflate`

- [ ] **Step 2: Failing tests**

`tests/lib/zip.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { unzipSync } from "fflate";
import { zipFiles } from "@/lib/zip";
describe("zipFiles", () => {
  it("round-trips", () => {
    const z = zipFiles([{ name: "a.txt", data: Buffer.from("hi") }, { name: "dir/b.bin", data: Buffer.from([1, 2, 3]) }]);
    const out = unzipSync(new Uint8Array(z));
    expect(Buffer.from(out["a.txt"]).toString()).toBe("hi");
    expect([...out["dir/b.bin"]]).toEqual([1, 2, 3]);
  });
});
```
`tests/lib/sets.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { unzipSync } from "fflate";
import { exportSetZip } from "@/lib/sets";
import { createNodeMeasurer, loadImageFromFile } from "@/engine/server";
import { unicornSet, CLIPART_SIZE } from "../fixtures/set-unicorn";

describe("exportSetZip", () => {
  it("zips one print PNG and one mockup per member with cm sizes", async () => {
    const set = unicornSet();
    const { zip, sizes } = await exportSetZip(set, { measure: createNodeMeasurer(), clipartSize: CLIPART_SIZE, loadImage: loadImageFromFile });
    const files = unzipSync(new Uint8Array(zip));
    expect(Object.keys(files).sort()).toEqual(["Keisya-Ayah.mockup.jpg", "Keisya-Ayah.png", "Keisya-Keisya.mockup.jpg", "Keisya-Keisya.png", "Keisya-Kenzi.mockup.jpg", "Keisya-Kenzi.png", "Keisya-Mama.mockup.jpg", "Keisya-Mama.png"]);
    expect(sizes["ayah"].widthCm).toBeLessThanOrEqual(29);
    expect(sizes["kid"].widthCm).toBeLessThanOrEqual(20);
  }, 120_000);
});
```

- [ ] **Step 3: Implement**

`src/lib/zip.ts`:
```ts
import { zipSync } from "fflate";
export function zipFiles(files: { name: string; data: Buffer }[]): Buffer {
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) entries[f.name] = new Uint8Array(f.data);
  return Buffer.from(zipSync(entries, { level: 6 }));
}
```
`src/lib/sets.ts`:
```ts
import { expand, type Set, type TextMeasurer } from "@/engine";
import { exportPrintPng, renderMockup, loadShirtAsset, defaultShirtFor, type RenderOpts } from "@/engine/server";
import { zipFiles } from "./zip";

const slug = (s: string) => s.trim().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");

export function buildDesigns(set: Set, measure: TextMeasurer, clipartSize: { w: number; h: number }) {
  return expand(set, { measure, clipart: clipartSize });
}

export async function exportSetZip(set: Set, deps: { measure: TextMeasurer; clipartSize: { w: number; h: number }; loadImage: RenderOpts["loadImage"] }) {
  const files: { name: string; data: Buffer }[] = [];
  const sizes: Record<string, { widthCm: number; heightCm: number }> = {};
  for (const { memberId, design } of buildDesigns(set, deps.measure, deps.clipartSize)) {
    const member = set.input.members.find(m => m.id === memberId)!;
    const base = `${slug(set.input.kidName)}-${slug(member.label)}`;
    const print = await exportPrintPng(design, deps.loadImage);
    files.push({ name: `${base}.png`, data: print.png });
    sizes[memberId] = { widthCm: print.widthCm, heightCm: print.heightCm };
    const shirt = await loadShirtAsset(defaultShirtFor(design.sizeClass));
    files.push({ name: `${base}.mockup.jpg`, data: await renderMockup(design, shirt, { loadImage: deps.loadImage, width: 2000 }) });
  }
  return { zip: zipFiles(files), sizes };
}
```
`src/app/actions/sets.ts` (`"use server"`): each action loads the row with `db.query.sets.findFirst`, validates with `SetInputSchema`/`SetStyleSchema`, calls the lib/ai function with real deps (`getProvider()`, `putBlob`, `createNodeMeasurer()`, `loadImageFromFile`), writes back with `db.update(sets)`, and returns plain JSON. `generateClipartAction`: `generateClipart(input.theme, …)` → set `input.clipartSrc` and, if a style exists, `style.clipartSrc`. `uploadClipartAction`: read `form.get("file") as File`, `sharp(buf).trim().png()`, `putBlob("clipart/upload-…png")`, same writes. `generateStyleAction`: `describeClipart(clipartSrc)` → `chooseStyle(input, {url, meta}, deps, note)` → save `style`, `aiFallback`. `exportSetAction`: `exportSetZip` → `putBlob("exports/<id>-<ts>.zip", zip, "application/zip")` → save `exportUrl`. Wrap each in try/catch and rethrow `new Error(<short user message>)` so the client can toast; log the original with `console.error` (never the API key).

- [ ] **Step 4: Run tests (lib), tsc, lint; commit** — `feat(app): set server actions and export zip`

---

### Task 10: Set editor page

**Files:**
- Create: `src/app/set/[id]/page.tsx`, `src/app/set/[id]/SetEditor.tsx`, `src/app/set/[id]/components/{InputsPanel,MemberTabs,CanvasPanel,Inspector,SizeReadout}.tsx`, `src/app/set/[id]/useSetEditor.ts`, `src/app/set/new/page.tsx`, `src/app/page.tsx` (replace scaffold), `src/app/globals.css` (minimal additions)
- Test: `tests/app/useSetEditor.test.ts` (reducer only), `e2e/editor.spec.ts`

**Interfaces:**
- `useSetEditor(initial: { id; input; style | null; })` → `{ state, dispatch, designs, selected, setSelected, memberId, setMemberId, dirty }`. Reducer actions: `setInput(patch)`, `setStyle(patch)`, `setMember(id)`, `addMember(m)`, `removeMember(id)`, `updateMember(id, patch)`, `patchLayer(memberId, layerId, patch, scope: "member" | "set")`, `resetOverride(memberId, layerId)`, `loaded(style)`.
  - `scope: "set"` for a text layer patch of `font`/`color`/`stroke` writes to `style` (font, palette) and for `x/y/w/h/size` writes the override to **every** member; `scope: "member"` writes only that member's override.
  - `designs` is `expand(set, ctx)` memoised on `[input, style, measurer, clipartSize]`; clipart size comes from loading the image once (`useImageSize(url)`).
- Page `/set/[id]`: server component loads the row, renders `<SetEditor initial=… />`. `/set/new`: creates a draft with defaults (`kidName: ""`, `age: 5`, `theme: ""`, `language: "id"`, `shirtColor: "#ffffff"`, members Ayah/Mama adult + kid) via `createSet` and redirects. `/`: "Buat set baru" button + list of recent sets (kid name, age, updatedAt, status).

Layout (Tailwind, three columns, 280 / flex / 280 px, stacked on narrow screens):
- **InputsPanel**: kid name, age (number), theme, language (id/en), shirt color (swatches: white, black, navy, red, pink, yellow + hex input), clipart block (thumbnail; "Generate dari tema" runs `generateClipartAction`; "Upload" file input runs `uploadClipartAction`), members list (rows: label input, kind select, size-class select, remove; quick-add buttons Ayah/Mama/Kakak/Adik/Custom), "Generate style (AI)" button, note input + "Regenerate". Buttons show pending state; errors toast (a tiny `useToast`).
- **MemberTabs**: one tab per member, label + size class; active tab sets `memberId`.
- **CanvasPanel**: toggle *On shirt* / *Print view*; scope toggle "Set" / "This member only"; the stage is `<DesignStage design scale editable selectedId onSelect onChange>` where `onChange` dispatches `patchLayer` with the current scope; *On shirt* draws the shirt PNG (`/mockups/<id>.png`, tinted via CSS `mix-blend-mode: multiply` over a colored div) behind the stage positioned by `chestAnchor` and `pxPerCm` (same maths as `renderMockup`, scaled to the panel width); *Print view* shows a checkerboard background. Scale = panel width / canvas.w.
- **Inspector**: for the selected layer: text (read-only for template slots, since text comes from wording), font select (curated), weight, size (number, print px), color, stroke color + width, shadow toggle (color, blur, dx, dy), align; image: x/y/w/h numbers; "Reset override" if this member has an override for the layer. Every change goes through `patchLayer` with the current scope.
- **SizeReadout**: `boundingBoxCm(design)` → "24.1 × 17.3 cm · max 29 cm" per member; red text + "Layer keluar dari area aman" when `!isWithinSafeArea(design)`; Export button disabled then.
- **Autosave**: debounce 800 ms after any input/style/override change → `saveSet(id, { input, style })`; show "Tersimpan" / "Menyimpan…".
- **Export**: `exportSetAction(id)` → opens `zipUrl`.

- [ ] **Step 1: Reducer test** (`tests/app/useSetEditor.test.ts`): import the pure `reducer` from `useSetEditor.ts`; assert `patchLayer(scope: "set", { x: 10 })` sets the override on every member, `patchLayer(scope: "member")` on one, `patchLayer(scope: "set", { font: "Bangers" })` writes `style.font`, `patchLayer(scope: "set", { color })` on a text layer writes `style.palette.primary` (or `.secondary` when layerId is `numeral`), `resetOverride` removes the key, `removeMember` refuses to remove the last `birthday-kid`.

- [ ] **Step 2: Build the components** following the layout spec above. Keep each component under ~150 lines; the reducer in `useSetEditor.ts` is pure and exported.

- [ ] **Step 3: e2e smoke** (`e2e/editor.spec.ts`, needs `DATABASE_URL`; skip otherwise): visit `/set/new`, expect redirect to `/set/<uuid>`, type kid name "Keisya", pick "Upload" and attach `public/samples/unicorn.png`, wait for the canvas, click the "Keisya" tab, expect the size readout to contain "max 20 cm", click Export → expect a link ending in `.zip`. (AI buttons are not exercised in e2e.)

- [ ] **Step 4: `pnpm test && pnpm tsc --noEmit && pnpm lint && pnpm test:e2e`; commit** — `feat(app): set editor`

---

### Task 11: Deploy and verify on Vercel

**Files:**
- Modify: `README.md` (project root: setup, env vars, scripts), `.env.example`

- [ ] **Step 1:** `vercel env add ZAI_API_KEY production preview development` (user supplies the key; never paste it in the transcript). Confirm `DATABASE_URL` and `BLOB_READ_WRITE_TOKEN` exist for all three environments (`vercel env ls`).
- [ ] **Step 2:** `pnpm db:migrate` against production `DATABASE_URL` (pull with `vercel env pull .env.production.local --environment=production`, run, delete the file).
- [ ] **Step 3:** Merge to `main` (user pushes), wait for the production deployment, open `/set/new`, create a set with an uploaded clipart, generate style, export, download the ZIP and open one PNG: transparent background, longest side ≤ limit (check with `sharp` metadata / `identify`).
- [ ] **Step 4:** Root README: what the app does, env vars, `pnpm dev`, `pnpm test`, `pnpm test:e2e`, golden regeneration, deploy notes (asset tracing, native packages). Commit — `docs: project readme and deploy notes`

---

## What plan 3 consumes
`db.schema.batches` and `sets.batchId/status/previewUrls`, `generateClipart`/`describeClipart`/`chooseStyle` with mocked-provider tests, `exportSetZip` per set, `renderMockup` at 600 px for previews, `SetInputSchema` for CSV validation, the `/set/[id]` editor for the gallery's "Edit" action.
