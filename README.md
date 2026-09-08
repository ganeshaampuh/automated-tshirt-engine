# Kaos Ulang Tahun — family birthday shirt set generator

An internal tool for a print/merch shop that produces **matching family birthday shirt sets**.
One *set* is one birthday child (name, age, theme) plus the family members who get a shirt.
The app turns that into one print-ready front-chest PNG per member, previews each on a shirt
mockup, lets a human tweak the design, and exports the whole set as a ZIP of 300 DPI
transparent PNGs.

- Clipart is AI-generated from the theme (Z.ai CogView) or uploaded by hand.
- Palette, font and wording are chosen by an LLM (Z.ai GLM), validated with Zod, and fall back
  to code defaults when the model misbehaves — a set never fails just because the LLM did.
- **Layout is a deterministic template** (`Collage`), never AI-placed, so print output is
  reproducible and testable.

The UI copy is in Indonesian on purpose (the shop's staff are the users); the code, comments and
this README are in English.

Reference output lives in `docs/samples/`. The full design spec is
`docs/superpowers/specs/2026-09-08-tshirt-design-generator-design.md`.

## The three plans

Work is split into three implementation plans under `docs/superpowers/plans/`:

1. **Engine core** (`2026-09-08-01-engine-core.md`) — done. The framework-free design engine:
   Zod-typed `SetInput`/`Design` documents, the sizing table, text fitting, the Collage template,
   the `@napi-rs/canvas` server renderer, mockup compositing, print export, golden-image tests.
2. **AI services + set editor** (`2026-09-08-02-ai-and-set-editor.md`) — done. The engine split
   into a browser-safe `@/engine` and a server-only `@/engine/server`, a Konva browser renderer
   with a Playwright parity test against the server renderer, the Z.ai provider wrapper, Neon
   Postgres (Drizzle) + Vercel Blob persistence, server actions, and the single-set editor at
   `/set/[id]`.
3. **CSV batch** — not written yet. It picks up from the interfaces plan 2 produced, listed at
   the bottom of plan 2 under *What plan 3 consumes*: the `batches` table and
   `sets.batchId/status/previewUrls`, `generateClipart`/`describeClipart`/`chooseStyle` with
   mocked-provider tests, `exportSetZip` per set, `renderMockup` at 600 px for gallery previews,
   `SetInputSchema` for CSV row validation, and the `/set/[id]` editor as the gallery's "Edit"
   action.

## Setup

Requires Node 20+ and pnpm (`packageManager` pins the exact pnpm version).

```bash
pnpm install
cp .env.example .env.local   # then fill it in
```

If you have access to the Vercel project, pull the values instead of hand-filling them:

```bash
vercel link            # once, if .vercel/ is not already present
vercel env pull .env.local --environment=development
```

Then `pnpm dev` and open http://localhost:3000.

To run migrations against production, pull production env to a throwaway file, run, and delete it:

```bash
vercel env pull .env.production.local --environment=production
pnpm dlx dotenv-cli -e .env.production.local -- pnpm db:migrate
rm .env.production.local
```

### Environment variables

| Name | What it is for |
| --- | --- |
| `DATABASE_URL` | Pooled Neon Postgres connection string. `src/db/index.ts` and `drizzle.config.ts` both require it; the app throws at import time without it. |
| `DATABASE_URL_UNPOOLED` | Direct (non-pooled) Neon connection, set by the Neon integration. Not read by app code today; keep it for tooling that needs a session-mode connection. |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob token. Clipart uploads/generations and export ZIPs are written there with `access: "public"` (URLs are unguessable). |
| `ZAI_API_KEY` | Z.ai API key for clipart generation, clipart description and style choice (`src/ai/`). Without it the "Generate clipart" and "Generate style" actions fail with an error toast — you can still upload clipart by hand, but a set needs a style before it can be exported. (The code fallbacks in `src/ai/` cover a *misbehaving* model, not a missing key.) |

Model ids and the base URL live only in `src/ai/config.ts`. Never log any of these values.

## Scripts

| Script | What it does |
| --- | --- |
| `pnpm dev` | Next.js dev server on :3000. |
| `pnpm build` / `pnpm start` | Production build and server. |
| `pnpm lint` | ESLint (flat config, `eslint-config-next`). |
| `pnpm test` | Vitest, the whole unit/integration suite. |
| `pnpm test:e2e` | Playwright (`e2e/`): the browser↔server render parity test and the editor smoke test. |
| `pnpm db:generate` | Drizzle Kit: generate a migration from `src/db/schema.ts` into `drizzle/`. |
| `pnpm db:migrate` | Apply pending migrations to `DATABASE_URL`. |
| `pnpm db:studio` | Drizzle Studio against `DATABASE_URL`. |
| `pnpm gen:fonts` | Regenerate `src/app/fonts.css` from the font registry in `src/engine/fonts.ts`. Run it after adding a font file. |

CI (`.github/workflows/ci.yml`) runs `tsc --noEmit`, `pnpm lint` and `pnpm test` with `CI=true` on
every push to `main` and every pull request; no `DATABASE_URL` is configured there, so the database
specs skip and a missing golden hard-fails instead of being written.

Database tests (`tests/db/**`) are skipped unless `DATABASE_URL` is set. Run them with your local
env loaded:

```bash
pnpm dlx dotenv-cli -e .env.local -- pnpm test tests/db
```

## Golden-image tests

`tests/engine/__golden__/` holds committed reference PNGs. The render tests draw the same design
again and compare with `pixelmatch`; any pixel drift fails the test. That is the point — a golden
failure means the renderer changed, and the diff is the evidence.

Regenerate only when you have looked at the new PNGs and agree with them:

```bash
UPDATE_GOLDEN=1 pnpm test        # rewrites every golden the run touches
```

A missing golden is written on the spot when running locally (and is a hard failure on CI), which
gives you a narrower lever for the mockup goldens: delete just those files and rerun.

```bash
rm tests/engine/__golden__/mockup-*.png && pnpm test tests/engine
```

Inspect the regenerated PNGs before committing them.

## Sizing rules

Print geometry is fixed at **300 DPI**, and the design canvas is a square whose side is the
maximum print dimension for the member's size class — the **longest side** of the artwork, so a
design never exceeds the shop's print area whichever way it is oriented:

| Size class | Longest side | Canvas at 300 DPI |
| --- | --- | --- |
| `adult` | 29 cm | 3425 px |
| `kids-1-9` | 20 cm | 2362 px |
| `kids-0-1` | 18 cm | 2126 px |

Layers must stay inside a 3% safe inset (`isWithinSafeArea()` guards export); the exported PNG is
transparent and cropped to the layers' bounding box plus a 1% margin. See `src/engine/README.md`
for the engine's own rules.

## Deploy notes (Vercel)

The project is git-connected to Vercel; pushing the default branch deploys production. Two pieces
of `next.config.ts` are load-bearing and easy to break:

- **`outputFileTracingIncludes`** — the engine reads font files from `public/fonts` and shirt
  mockups from `public/mockups` off disk at runtime via `process.cwd()`. Vercel's tracer cannot see
  those dynamic reads, so the config includes `./public/fonts/**/*` and `./public/mockups/**/*`
  for every route explicitly. Without it the serverless function boots fine and then fails at
  render time with a missing-font or missing-mockup error.
- **`serverExternalPackages: ["@napi-rs/canvas", "sharp"]`** — both ship native binaries and must
  not be bundled by the compiler.

Native dependencies are **pinned to exact versions** in `package.json` (`@napi-rs/canvas` 1.0.8,
`sharp` 0.35.4) because their prebuilt binaries are what the golden images were rendered against;
a patch bump can shift antialiasing and fail the goldens.

`pnpm build && pnpm start` locally verifies the app compiles and serves, but it does **not**
exercise Vercel's file tracing — a local server reads the whole repo from disk, so a missing
`outputFileTracingIncludes` entry only shows up on a deployed function.

## Known limitations

- `layerBounds()` is an ink-aware but conservative *envelope*, not a per-glyph trace: a text
  layer's box is `maxWidth` × `size · lines · (1 + DESCENDER_RATIO)` grown by the stroke width, so
  a line with no descender reserves height it does not use. Safe-area checks and reported cm sizes
  never under-report, but may over-report.
- The shirt mockups in `public/mockups/` are **placeholders** generated by
  `scripts/make-placeholder-shirts.ts`, not photographs of the shop's actual garments. The sidecar
  JSON (`pxPerCm`, `chestAnchor`) must be re-measured when real photos land.
- The editor loads **every** curated font face eagerly: `src/app/fonts.css` declares all nine
  `@font-face` rules with `font-display: block`, so the browser fetches ~1 MB of TTF before the
  first design paints, whether or not the design uses those families.
- Fonts must ship as **static instances**, one file per weight — never a variable font. Skia
  (`@napi-rs/canvas`) ignores a variable font's `wght` axis while Chrome applies it, so the print
  render and the on-screen preview would disagree.
- Single-tenant: no accounts, no auth. Anyone who can reach the deployment can read and edit every
  set.
