# T-Shirt Design Generator — Design Spec

Date: 2026-09-08
Status: Draft for review

## 1. Purpose

A web app for a print/merch business that turns **text + an image** into a
**print-ready front-chest t-shirt design**, previews it on a shirt mockup, lets
the user tweak it, and exports a 300 DPI PNG. It works one design at a time and
in **batch from a CSV**, with every batch row passing human review before export.

AI (Z.ai GLM models) handles composition: layout choice, typography, colors,
placement. It may also generate the image from a prompt. AI never produces the
final pixels; a deterministic renderer does.

## 2. Scope

In scope:
- Single-design editor with AI composition, manual editing, mockup preview, PNG export
- Image source: user upload **or** AI generation from a text prompt
- Batch: CSV upload → background processing → review gallery → ZIP export
- One print area: front chest, 300 DPI, transparent background, sized per garment
  size class (see §4.1)

Out of scope (YAGNI):
- Back, sleeve, or multi-placement designs
- Vector (SVG/PDF) export
- Public API, customer-facing storefront, ordering, payments
- Multi-user accounts / permissions (single-tenant tool; auth can be added later)

## 3. Architecture

Next.js (App Router, TypeScript) on Vercel, single repo. Three layers:

```
┌──────────────────────────────────────────────────────────┐
│ Web app (Next.js)                                        │
│  /design/[id]  editor + mockup     /batch/[id] gallery   │
│  server actions: compose, generateImage, export, batch   │
├──────────────────────────────────────────────────────────┤
│ AI services (src/ai)          │ Design engine (src/engine)│
│  provider interface → Z.ai    │  pure: Design JSON → px  │
│  composeDesign()              │  archetypes, text fitting│
│  describeImage()              │  browser adapter (Konva) │
│  generateImage()              │  server adapter (canvas) │
├──────────────────────────────────────────────────────────┤
│ Storage: Vercel Blob (images, PNGs, ZIPs)                │
│          Postgres via Vercel Marketplace (designs, batches)│
│ Jobs:    Vercel Workflow (batch processing)              │
└──────────────────────────────────────────────────────────┘
```

Rule: the engine has **no React, no browser globals, no network**. Everything
that draws pixels goes through it, so single mode, batch previews, and print
export cannot drift apart.

## 4. The Design JSON (core contract)

```ts
type Design = {
  version: 1;
  sizeClass: "adult" | "kids-0-1" | "kids-1-9";
  canvas: { w: number; h: number; dpi: 300 }; // square, side = maxCm(sizeClass) at 300 DPI
  shirtColor: string;                          // hex, used for mockup + contrast
  archetype: "stacked" | "overlay" | "badge" | "text-only" | "image-only";
  layers: Layer[];
};

type ImageLayer = {
  id: string; type: "image";
  src: string;               // Blob URL
  x: number; y: number; w: number; h: number;   // print px, top-left origin
  rotation?: number;
};

type TextLayer = {
  id: string; type: "text";
  text: string;
  font: string;              // family from curated list (see §6)
  weight: 400 | 700 | 900;
  size: number;              // px at print scale
  color: string;
  letterSpacing?: number;
  transform?: "none" | "upper";
  align: "left" | "center" | "right";
  x: number; y: number; maxWidth: number;      // print px; text wraps at maxWidth
  rotation?: number;
  arc?: number;              // degrees, badge archetype only
};
```

All coordinates are in print pixels. The browser displays at
`scale = displayWidth / canvas.w`. Validated with Zod; the same schema validates
LLM output, DB rows, and editor state.

### 4.1 Sizing guidelines (print area)

The print area is limited by the **longest side** of the design's bounding box:

| Size class | Garment | Max longest side |
|---|---|---|
| `adult` | Dewasa XS–5XL | 29 cm |
| `kids-0-1` | Kids 0–1 tahun | 18 cm |
| `kids-1-9` | Kids 1–9 tahun | 20 cm |

Implementation:

- `sizing.ts` holds the table above as the single source of truth:
  `maxCm(sizeClass)` and `maxPx(sizeClass) = round(maxCm / 2.54 * 300)`
  (adult 3425 px, kids-0-1 2126 px, kids-1-9 2362 px).
- The canvas is a **square** of side `maxPx`. Any design whose layers stay on
  the canvas automatically satisfies the guideline in both directions. The
  exported PNG is cropped to the layers' bounding box (plus a 1% margin), so
  the printer receives a file whose longest side is at most `maxCm`.
- Archetypes take the canvas size as input, never hard-code pixels. The safe
  area is 3% inset from the canvas edge.
- The engine exposes `boundingBoxCm(design)` → `{ w, h, longest }`. The
  editor shows it live ("24.1 × 17.3 cm, max 29 cm") and blocks export with a
  clear message if manual edits push a layer outside the canvas.
- Changing `sizeClass` on an existing design rescales all layers
  proportionally to the new canvas (same relative composition).
- Default `sizeClass` is `adult`.

## 5. Design engine (`src/engine`)

Pure TypeScript, tested in isolation.

- **Archetypes** (`archetypes/*.ts`): `layout(input) → Design`. Input is the
  canvas size (from `sizeClass`, §4.1), text, image metadata (w, h), shirt
  color, and the LLM's choices (§6). Each archetype computes exact positions
  inside a safe area (3% inset from the canvas edge), so nothing can be placed
  off the print area or exceed the size guideline.
  - `stacked`: image centered in top ~60%, text block below
  - `overlay`: image fills width, text centered over it with optional shadow
  - `badge`: image centered, text arced above and/or below
  - `text-only`: large text block, auto-fit to width
  - `image-only`: image centered, max size
- **Text fitting** (`textFit.ts`): given font, weight, maxWidth, and a target
  size, measure and shrink until the text fits (min size floor). Measurement
  uses the adapter's `measureText`, so the algorithm is identical on both sides.
- **Adapters**:
  - `render/browser.ts`: Konva stage. Maps Design → Konva nodes and back
    (drag/resize emit Design updates).
  - `render/server.ts`: `@napi-rs/canvas` (or `node-canvas`). Registers the
    self-hosted fonts, renders Design → PNG buffer at any scale.
- **Mockup compositor** (`mockup.ts`): draws a design onto a shirt photo.
  Shirt assets are white-base PNGs with metadata `{ sizeClass, pxPerCm,
  chestAnchor: {x, y} }`, where `pxPerCm` is the photo's real-world scale and
  `chestAnchor` is the center-top of the print zone. The design is scaled by
  `pxPerCm * maxCm / canvas.w` and centered under the anchor, so a 20 cm
  design looks 20 cm wide on the shirt and the preview is honest about size.
  Shirt color is applied by tinting the white base; the design is drawn with
  `multiply` blend so fabric texture shows through. Used by both the editor
  and server previews.

## 6. AI services (`src/ai`)

Provider: **Z.ai** (OpenAI-compatible endpoint, `ZAI_API_KEY`).

```ts
interface AIProvider {
  chatJSON<T>(opts: { system: string; user: string; schema: ZodType<T>; images?: string[] }): Promise<T>;
  generateImage(opts: { prompt: string; size: string }): Promise<Buffer>;
}
```

`ZaiProvider` implements it with:
- `chatJSON` → GLM text model (e.g. `glm-4.5`) with JSON response mode;
  vision model (e.g. `glm-4.5v`) when `images` is present
- `generateImage` → CogView image model

Model IDs live in one config file so they can be bumped without code changes.

### 6.1 `describeImage(imageUrl) → ImageMeta`
Width, height, aspect ratio, dominant colors (computed locally with Sharp),
plus a one-sentence caption and a `kind` (`photo | illustration | logo |
pattern`) from the vision model. Cached per Blob URL.

### 6.2 `composeDesign(input) → Design`
Input: `{ text, shirtColor, sizeClass, imageMeta | null, note?: string }`.
The prompt tells the model the size class (kids designs favour simpler,
bolder compositions), but the model never sees or outputs pixel values.

The LLM chooses only from constrained options:

```ts
type Composition = {
  archetype: Archetype;
  font: CuratedFont;                // enum of ~12 self-hosted families
  weight: 400 | 700 | 900;
  transform: "none" | "upper";
  letterSpacing: number;            // -0.05 .. 0.3 em
  textColor: string;                // hex, must contrast with shirtColor
  imageScale: number;               // 0.5 .. 1.0 of archetype's max
  textEmphasis: number;             // 0.5 .. 1.5, multiplies base text size
  rationale: string;                // one line, shown to user
};
```

Then the chosen archetype turns `Composition` into a full `Design`.
Validation via Zod; on failure retry once with the error appended; on second
failure return `stacked` with safe defaults and flag `aiFallback: true` on the
record. A batch row never hard-fails because of the LLM.

`note` (e.g. "bigger text", "more vintage") is appended to the prompt on
regenerate. Regenerate replaces layout fields but keeps the user's text and
image.

### 6.3 `generateImage(prompt) → Blob URL`
Prompt is augmented for print: "single centered subject, plain white
background, no text, no watermark, high contrast, t-shirt graphic". Result is
run through background removal (Sharp flood-fill on near-white; good enough
for v1, swappable later), stored to Blob, then goes through `describeImage`
like an upload.

## 7. Web app

### 7.1 Single design: `/design/[id]`
Three panels:
- **Left, inputs**: size class selector (Dewasa / Kids 0–1 / Kids 1–9, with
  the cm limit shown), text field, image (upload dropzone **or** prompt +
  Generate button), shirt color swatches, "Compose with AI" button, note field
  + Regenerate.
- **Center, canvas**: toggle between *On shirt* (mockup compositor) and
  *Print view* (transparent, exactly what the printer receives). Layers are
  draggable/resizable with snap-to-center guides; double-click text to edit
  inline.
- **Right, inspector**: selected layer's properties (font, weight, size,
  color, spacing, align), plus a live **size readout** of the whole design in
  cm against the class limit, red when a layer leaves the canvas. Every change
  writes to the Design JSON; Konva is a view of it, never the source of truth.
- **Export** button → server action renders full-res PNG, stores to Blob,
  returns download link. Also renders a 2000 px mockup JPG for listings.

Autosave: debounced server action writes Design JSON to the DB.

### 7.2 Batch: `/batch/new` and `/batch/[id]`
CSV columns: `text` (required), `image_url` **or** `image_prompt` (one
required), optional `size_class` (`adult` | `kids-0-1` | `kids-1-9`, default
`adult`), `shirt_color` (hex or name, default white), `sku`, `note`.
Max 500 rows in v1.

Upload → parse + validate (report bad rows before starting) → create Batch
and one Design per row (`status: queued`) → start Workflow.

**Workflow** (Vercel Workflow), concurrency 4 rows, each row:
1. fetch `image_url` or `generateImage(image_prompt)` → Blob
2. `describeImage` → `composeDesign`
3. render 600 px mockup preview → Blob
4. `status: ready`, or `status: failed` with `error` text

Failures are per-row and never stop the batch.

**Review gallery**: grid of preview cards (polls every few seconds while
processing). Per card: **Approve**, **Edit** (opens `/design/[id]`, the same
editor), **Regenerate** (with optional note), **Reject**. Bulk approve
selected. Counts by status at the top.

**Export ZIP**: renders full-res PNGs for `approved` rows only (in a
Workflow, since 100+ renders exceed one request), named `{sku|slug(text)}.png`,
plus `report.csv` listing every row with status and error. ZIP → Blob →
download link on the batch page.

## 8. Data model

```
designs
  id, batch_id?, status (draft|queued|processing|ready|approved|rejected|failed)
  source_text, source_image_url?, source_image_prompt?, size_class, shirt_color, note?
  design_json (jsonb), ai_fallback bool, error?
  preview_url?, export_url?, created_at, updated_at

batches
  id, name, status (processing|ready|exporting|exported|failed)
  row_count, ready_count, approved_count, failed_count
  csv_url, zip_url?, created_at, updated_at
```

## 9. Fonts and assets

- ~12 curated open-license display fonts (e.g. Bebas Neue, Anton, Oswald,
  Playfair Display, Lobster, Permanent Marker, Montserrat, Archivo Black,
  Pacifico, Bangers, Special Elite, Righteous) self-hosted in `/public/fonts`
  and registered identically in the browser (`@font-face`) and server adapter.
  The `CuratedFont` enum is generated from this list.
- Shirt mockups: white-base photos with `{ sizeClass, pxPerCm, chestAnchor }`
  in a JSON sidecar. v1 ships an adult flat lay, an adult on-model, and one
  kids flat lay (used for both kids classes).

## 10. Error handling

| Where | Behavior |
|---|---|
| LLM invalid JSON | retry once with error, then `stacked` fallback, `ai_fallback=true` |
| LLM/image API down | row `failed` with message; single mode shows toast, keeps prior design |
| Bad image URL / unsupported format | row `failed`; single mode inline error |
| Text too long for any size | textFit floors at min size and wraps; archetype warns in `rationale` |
| Layer outside canvas after manual edit | editor readout turns red; export blocked with message; batch rows from AI can never hit this |
| Unknown `size_class` in CSV | row rejected at validation with message |
| Export render error | design `error` set, batch continues, listed in `report.csv` |
| CSV malformed | rejected before batch creation with row-level messages |

## 11. Testing

- **Engine**: golden-image tests. Fixed Design JSON fixtures rendered by the
  server adapter and compared to stored PNGs (pixel diff threshold). Browser
  adapter checked with Playwright screenshots against the same fixtures.
- **Archetypes / textFit**: unit tests with long text, one word, empty image,
  extreme aspect ratios, and all three size classes; assert every layer within
  safe area and `boundingBoxCm(design).longest <= maxCm(sizeClass)`.
- **Sizing**: `maxPx` values, exported PNG longest side in cm ≤ limit for each
  class, proportional rescale on size-class change preserves relative layout.
- **AI**: `AIProvider` mocked. Tests for happy path, malformed JSON → retry →
  fallback, contrast enforcement.
- **Mockup compositor**: golden-image test per shirt asset and a dark + light
  shirt color.
- **Batch**: integration test with a 3-row CSV: success, bad image URL, forced
  AI failure. Assert statuses, report.csv, and ZIP contents.
- **CSV parser**: unit tests for missing columns, both/neither image columns,
  bad hex.

## 12. Build order (for the implementation plan)

1. Scaffold Next.js, DB, Blob, fonts, shirt assets
2. Engine: Design schema, sizing table, archetypes, textFit, server renderer + golden tests
3. Mockup compositor
4. Z.ai provider + composeDesign + describeImage + generateImage (mocked tests)
5. Single-design editor page with Konva, export
6. CSV parse, batch Workflow, review gallery, ZIP export
