# Family Birthday Shirt Set Generator — Design Spec

Date: 2026-09-08
Status: Draft for review (v2, rewritten around sets + templates)

## 1. Purpose

A web app for a print/merch business that produces **matching family
birthday shirt sets**. One set = one birthday child (name, age, theme) plus a
list of family members. The app produces one print-ready front-chest PNG per
member, previews each on a t-shirt mockup, lets the user tweak the set, and
exports 300 DPI PNGs. It works one set at a time and in **batch from a CSV**,
with human review before export.

AI (Z.ai GLM / CogView models) generates the theme clipart and chooses palette,
font, and wording. **Layout is a deterministic template**, never AI-placed.

Reference sample: `docs/samples/` (unicorn set: Ayah, Keisya, Kenzi, Mama).

## 2. Scope

In scope:
- One layout template in v1: **Collage** (big numeral left, clipart right
  overlapping it, name line top, "th Birthday" beside, label bottom)
- Set-level editing: change once, all members update; per-member overrides
- Clipart: AI-generated from theme **or** uploaded
- Per-member size class (kids vs adult) with print-area limits (§5)
- Batch: CSV (one row per set) → expansion → background rendering → review
  gallery → ZIP export
- Export: 300 DPI PNG, transparent background, front chest, cropped to design

Out of scope (YAGNI):
- Multiple layout templates (architecture allows it; only Collage ships)
- Back/sleeve placements, vector export
- Public API, storefront, orders, payments
- Multi-user accounts (single-tenant internal tool)

## 3. Domain model

```ts
type SizeClass = "adult" | "kids-0-1" | "kids-1-9";

type Member = {
  id: string;
  kind: "birthday-kid" | "family";
  label: string;              // "Ayah", "Mama", "Kenzi" — or kid's name
  sizeClass: SizeClass;
  overrides?: Partial<Design>; // rare, per-member manual tweaks
};

type SetInput = {
  kidName: string;            // "Keisya"
  age: number;                // 5
  theme: string;              // "unicorn", "dinosaur", "spiderman-like hero"
  clipartSrc?: string;        // Blob URL if uploaded; else generated
  shirtColor: string;         // hex, default white
  language: "id" | "en";      // wording: "Ulang Tahun ke-5" vs "5th Birthday"
  members: Member[];
};

type SetStyle = {             // chosen by AI, editable by user
  template: "collage";
  font: CuratedFont;
  palette: { primary: string; secondary: string; outline: string };
  clipartSrc: string;
  wording: { kidTop: string; familyTop: string; ordinal: string; occasion: string };
  // e.g. kidTop "My", familyTop "{kidName}", ordinal "th", occasion "Birthday"
};

type Design = {               // one member's renderable design (§4)
  version: 2;
  sizeClass: SizeClass;
  canvas: { w: number; h: number; dpi: 300 };
  shirtColor: string;
  layers: Layer[];
};
```

**Set** = `SetInput + SetStyle`. `expand(set) → Design[]`, one per member, via
the template (§4). Designs are derived and cached, never hand-authored except
through `overrides`.

## 4. Template and layers

### 4.1 Layers

```ts
type ImageLayer = { id; type: "image"; src; x; y; w; h; rotation? };
type TextLayer = {
  id; type: "text"; text; font: CuratedFont; weight; size; color;
  stroke?: { color: string; width: number };   // numeral outline
  shadow?: { color: string; blur: number; dx: number; dy: number };
  letterSpacing?; transform?: "none" | "upper"; align; x; y; maxWidth; rotation?;
};
```

Coordinates in print px. Browser scale = `displayWidth / canvas.w`.

### 4.2 Collage template

`collage(setStyle, member, canvas) → Design`. Slots, as fractions of the
canvas, tuned to the reference sample:

| Slot | Content | Position |
|---|---|---|
| `numeral` | `age`, fill `secondary`, stroke `outline` | left, ~55% height, vertically centered |
| `ordinalOccasion` | "th Birthday" (two lines) | right of numeral, upper third |
| `topLine` | kid: `wording.kidTop`; family: `kidName` | top, centered above ordinal |
| `clipart` | clipart image | right-center, overlaps numeral by ~20% |
| `bottomLabel` | kid: `kidName`; family: `label` | bottom, centered, auto-fit width |

Rules: text auto-shrinks to fit slot width (`textFit`); all slots stay inside
a 3% safe inset; the template receives the canvas size and never hard-codes
pixels. `overrides` are applied on top of the template output.

### 4.3 Wording

- `en`: kidTop "My", ordinal by number ("st/nd/rd/th"), occasion "Birthday"
- `id`: kidTop "Ulang Tahunku", family top "{kidName}", ordinal "ke-", occasion "Ulang Tahun" (layout swaps ordinal before numeral)
- AI may propose alternatives (§6) but the defaults are code, so a batch never depends on the LLM for wording.

## 5. Sizing guidelines (print area)

| Size class | Garment | Max longest side |
|---|---|---|
| `adult` | Dewasa XS–5XL | 29 cm |
| `kids-0-1` | Kids 0–1 tahun | 18 cm |
| `kids-1-9` | Kids 1–9 tahun | 20 cm |

- `sizing.ts` is the single source of truth: `maxCm(sizeClass)`,
  `maxPx = round(maxCm / 2.54 * 300)` (adult 3425, kids-0-1 2126, kids-1-9 2362).
- Canvas is a **square of side `maxPx`**. Layers on the canvas therefore meet
  the guideline. Export crops to the layers' bounding box plus 1% margin, so
  the printed file's longest side is ≤ `maxCm`.
- `boundingBoxCm(design)` → `{ w, h, longest }`, shown live in the editor,
  red and export-blocked if a manual edit leaves the canvas.
- Default: `birthday-kid` members get `kids-1-9` if `age <= 9` else `adult`;
  `family` members default to `adult`. Editable per member.

## 6. AI services (`src/ai`)

Provider: **Z.ai** via OpenAI-compatible API (`ZAI_API_KEY`). Model IDs in
one config file.

```ts
interface AIProvider {
  chatJSON<T>(opts: { system; user; schema: ZodType<T>; images?: string[] }): Promise<T>;
  generateImage(opts: { prompt; size }): Promise<Buffer>;
}
```

- `chatJSON` → GLM text model (JSON mode); GLM vision model when `images` given
- `generateImage` → CogView

### 6.1 `generateClipart(theme, palette hint?) → Blob URL`
Prompt augmented for print: "cute flat vector-style {theme}, single subject,
centered, plain white background, no text, thick outlines, pastel colors,
kids t-shirt graphic". Post-process: near-white background removal (Sharp),
trim to content. Used unless `clipartSrc` was uploaded.

### 6.2 `describeClipart(src) → ClipartMeta`
Dimensions, dominant colors (local, Sharp), caption + `kind` (vision model).
Cached per Blob URL.

### 6.3 `chooseStyle(setInput, clipartMeta) → SetStyle`
LLM picks only from constrained options:

```ts
{ font: CuratedFont;                  // playful group favoured for kids
  palette: { primary; secondary; outline };   // must be from/near clipart colors, contrast vs shirtColor
  wording?: Partial<Wording>;         // optional tweaks, defaults from §4.3
  rationale: string }
```

Zod-validated; retry once with the error; then fall back to defaults derived
from clipart dominant colors + `Fredoka`, flag `ai_fallback=true`. A batch row
never hard-fails because of the LLM.

"Regenerate" accepts a note ("lebih ceria", "different font") appended to the
prompt; it replaces `SetStyle` fields but keeps clipart unless asked.

## 7. Design engine (`src/engine`)

Pure TypeScript. No React, no browser globals, no network.

- `sizing.ts`, `templates/collage.ts`, `textFit.ts`, `expand.ts`
- `render/browser.ts`: Konva stage ⇄ Design (drag/resize emit overrides)
- `render/server.ts`: `@napi-rs/canvas`, registers self-hosted fonts, renders
  any Design at any scale to PNG buffer; supports stroke + shadow identically
- `mockup.ts`: composites a Design onto a shirt photo. Shirt assets:
  white-base PNG + `{ sizeClass, pxPerCm, chestAnchor }`. Design scaled by
  `pxPerCm * maxCm / canvas.w`, centered under the anchor, `multiply` blend;
  shirt color by tinting the white base. So a 20 cm design looks 20 cm on the
  kids shirt and 29 cm looks 29 cm on the adult shirt.

## 8. Web app (Next.js App Router, Vercel)

### 8.1 Set editor: `/set/[id]`
- **Left**: kid name, age, theme, language, shirt color, clipart (Generate /
  Upload), members list (label, kind, size class, add/remove; quick-add
  Ayah/Mama/Kakak/Adik), "Generate style" button, note + Regenerate.
- **Center**: member tabs (Ayah | Keisya | Kenzi | Mama) over a canvas.
  Toggle *On shirt* / *Print view*. Edits to shared slots (numeral, clipart,
  ordinal, font, colors) write to `SetStyle` and update every member. Dragging
  a layer while "This member only" is checked writes an override. Live size
  readout in cm against the member's limit.
- **Right**: inspector for the selected layer (font, size, colors, stroke,
  shadow), plus a "Reset override" for member-specific tweaks.
- **Export set**: server action renders every member at full res, returns a
  ZIP (`{kidName}-{label}.png`) plus 2000 px mockup JPGs.
- Autosave (debounced) of `SetInput` + `SetStyle` + overrides.

### 8.2 Batch: `/batch/new`, `/batch/[id]`
CSV, one row per set:

```
kid_name, age, theme, members, language?, shirt_color?, clipart_url?, sku_prefix?, note?
Keisya,   5,   unicorn, "Ayah:adult;Mama:adult;Kenzi:kids-1-9;Keisya:kid", id, #ffffff
```

`members` syntax: `Label:sizeClass` separated by `;`; the token `kid` marks
the birthday child (size class auto per §5). Max 200 sets / 1000 members.

Validation reports bad rows before starting. Then create Batch, one Set per
row, one Design per member (`queued`), and start a Vercel Workflow:

Per set (concurrency 3): fetch/generate clipart → describe → chooseStyle →
expand → render 600 px mockup per member → members `ready`, or set `failed`
with message. Failures are per set and never stop the batch.

**Review gallery**: one card per set showing all member previews in a row
(like the reference sample). Actions: Approve set, Edit (opens `/set/[id]`),
Regenerate (with note), Reject. Bulk approve. Status counts at the top.

**Export ZIP**: full-res renders for approved sets only, in a Workflow.
Folder per set: `{sku_prefix|kidName}/{label}.png`, plus `report.csv`.

## 9. Data model

```
sets      id, batch_id?, status (draft|queued|processing|ready|approved|rejected|failed)
          input jsonb (SetInput), style jsonb (SetStyle), ai_fallback bool, error?
          created_at, updated_at
designs   id, set_id, member_id, size_class, overrides jsonb?, preview_url?, export_url?
batches   id, name, status, set_count, ready_count, approved_count, failed_count,
          csv_url, zip_url?, created_at, updated_at
```

## 10. Fonts and assets

- Curated, self-hosted fonts registered identically in browser and server.
  Playful group for kids sets: Fredoka One, Baloo 2, Chewy, Bangers, Lilita
  One, Luckiest Guy, plus **user-uploaded fonts** (TTF/OTF → Blob, registered
  at runtime on both sides) because the shop will want its Disney-style
  script. Waltograph-type fonts are personal-use only; the shop supplies a
  licensed one. `CuratedFont` = built-in list ∪ uploaded fonts.
- Shirt mockups: adult flat lay, adult on-model, kids flat lay, each with the
  `pxPerCm`/`chestAnchor` sidecar.

## 11. Error handling

| Where | Behavior |
|---|---|
| LLM invalid JSON | retry once, then default style, `ai_fallback=true` |
| Clipart generation fails | set `failed`; single mode: toast, keep previous clipart |
| Bad `clipart_url` / format | set `failed` |
| Text too long | textFit shrinks to floor and wraps |
| Override leaves canvas | red readout, export blocked for that member |
| Bad `members` syntax / size class | row rejected at CSV validation |
| Export render error | member `error`, batch continues, in `report.csv` |

## 12. Testing

- **Template**: golden-image tests of the Collage for all 3 size classes, kid
  and family variants, `en` and `id`; every layer within safe area;
  `boundingBoxCm.longest <= maxCm`.
- **textFit / wording / sizing**: unit tests (long names like "Muhammad
  Rizky Ramadhan", age 1/2/3/11 ordinals, size-class defaults).
- **Renderer parity**: browser (Playwright) vs server renders of the same
  fixtures within a pixel-diff threshold, including stroke + shadow.
- **Mockup**: golden per shirt asset, light + dark shirt.
- **AI**: mocked provider; happy path, malformed JSON → retry → fallback,
  palette contrast enforcement.
- **CSV + batch**: 3-row integration test (success, bad clipart URL, forced AI
  failure); assert per-member statuses, ZIP layout, `report.csv`.

## 13. Build order (for the implementation plan)

1. Scaffold Next.js, Postgres (Marketplace), Blob, fonts, shirt assets, sample
2. Engine: types, sizing, textFit, Collage template, expand, server renderer + goldens
3. Mockup compositor
4. Z.ai provider, generateClipart, describeClipart, chooseStyle (mocked tests)
5. Set editor with Konva, member tabs, overrides, export ZIP
6. CSV parse, batch Workflow, review gallery, batch ZIP export
