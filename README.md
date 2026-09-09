# Kaos Ulang Tahun — family birthday shirt set generator

[![CI](https://github.com/ganeshaampuh/automated-tshirt-engine/actions/workflows/ci.yml/badge.svg)](https://github.com/ganeshaampuh/automated-tshirt-engine/actions/workflows/ci.yml)

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
3. **CSV batch** (`2026-09-09-03-csv-batch.md`) — done. A guarded door for every remote image, CI,
   per-member state, the CSV parser, batch creation, the self-chaining processing route, the review
   gallery and the streaming ZIP export. See [Batch](#batch) below for how to drive it.

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

> [!WARNING]
> **Production, preview and development currently share one Neon database.** `vercel env pull`
> hands your laptop the same `DATABASE_URL` the shop's deployment uses, so a local batch run writes
> batches and sets the shop sees, and `pnpm db:migrate` migrates production. Until the branches are
> split (see [Known limitations](#known-limitations) for the click-path), treat every local run as a
> production write: use the smallest CSV that proves the point, and reject or delete what you make.

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
| `pnpm test:e2e` | Playwright (`e2e/`): the browser↔server render parity test, the editor smoke test, and the batch road (`batch.spec.ts`). The editor spec and the batch road both write real rows, so both need `DATABASE_URL` **and** `ALLOW_DB_TESTS=1`. Both skip without them. |
| `pnpm db:generate` | Drizzle Kit: generate a migration from `src/db/schema.ts` into `drizzle/`. |
| `pnpm db:migrate` | Apply pending migrations to `DATABASE_URL`. |
| `pnpm db:studio` | Drizzle Studio against `DATABASE_URL`. |
| `pnpm gen:fonts` | Regenerate `src/app/fonts.css` from the font registry in `src/engine/fonts.ts`. Run it after adding a font file. |

CI (`.github/workflows/ci.yml`) runs `tsc --noEmit`, `pnpm lint` and `pnpm test` with `CI=true` on
every push to `main` and every pull request; no `DATABASE_URL` or `ALLOW_DB_TESTS` is configured
there, so the database specs skip and a missing golden hard-fails instead of being written.

Database tests (`tests/db/**`) and both database-backed end-to-end specs (`e2e/batch.spec.ts`,
`e2e/editor.spec.ts`) write real rows, previews and ZIPs, so they need two things: a `DATABASE_URL`, and `ALLOW_DB_TESTS=1` on top of it.
Without the opt-in they are reported as skipped, never silently dropped. The second condition exists
because all three environments still share one database (see [Known
limitations](#known-limitations)), so the `DATABASE_URL` in a developer's `.env.local` is the shop's
own — having the env loaded must not be enough to write into it.

```bash
# unit + database tests
ALLOW_DB_TESTS=1 pnpm dlx dotenv-cli -e .env.local -- pnpm test
# just the database ones
ALLOW_DB_TESTS=1 pnpm dlx dotenv-cli -e .env.local -- pnpm test tests/db
# the batch road in a browser
ALLOW_DB_TESTS=1 pnpm dlx dotenv-cli -e .env.local -- pnpm test:e2e e2e/batch.spec.ts
```

## Batch

One CSV in, one ZIP of print-ready PNGs out. `/batch/new` takes the file, `/batch/[id]` is the
review gallery.

### The CSV

The first row is the header. Column order is free and unknown columns are ignored.

| Column | Required | What it holds |
| --- | --- | --- |
| `kid_name` | yes | The birthday child's name. |
| `age` | yes | Whole number, 0–120. It also decides the child's size class (≤1 → `kids-0-1`, ≤9 → `kids-1-9`, else `adult`). |
| `theme` | yes | Free text, e.g. `unicorn pastel`. Drives the clipart and the style. |
| `members` | yes | `Nama:ukuran` tokens separated by `;`. Size is `adult`, `kids-0-1`, `kids-1-9`, or `kid` for the birthday child — **exactly one** `kid` per row. Quote the cell if it contains a comma. |
| `language` | no | `id` or `en`. Empty means `id`. |
| `shirt_color` | no | Hex (`#ffffff`) or a name from `src/lib/shirtColors.ts` (`putih`, `navy`, `hitam`, …). Empty means white. |
| `clipart_url` | no | Skips AI clipart generation for that row. **`https://` only, and the host must be publicly resolvable** — see below. A `data:image/…` URI works too. |
| `sku_prefix` | no | Names the set's folder in the ZIP. Empty means the kid's name, which two families can share. |

`tests/fixtures/batch-sample.csv` is the worked example — 3 sets, 10 shirts:

```csv
kid_name,age,theme,members,language,shirt_color,sku_prefix
Keisya,5,unicorn pastel,Ayah:adult;Mama:adult;Kenzi:kids-1-9;Keisya:kid,id,#ffffff,KEI
Bima,1,dinosaurus,"Ayah:adult;Bunda:adult;Bima:kid",id,navy,BIM
Nadia,11,luar angkasa,Papa:adult;Mama:adult;Nadia:kid,en,hitam,
```

**Caps: 200 sets and 1000 shirts per file** (`MAX_SETS` / `MAX_MEMBERS` in `src/lib/csv.ts`), and
8 MB of CSV. "Periksa" is a dry run that writes nothing; a batch is only created when every row is
clean, so you never get half the rows you uploaded.

**`clipart_url` is fetched through the guarded door** in `src/lib/remoteImage.ts`, because it is an
address out of a spreadsheet: https only, no credentials in the URL, port 443 only, the host must
resolve entirely to public address space (loopback, private ranges and the cloud metadata address
are refused), the check is repeated after every redirect, at most 3 redirects, a 15 s timeout, and
the body is capped at 16 MB while it streams. An image behind a login, on an intranet host, or
served over http will fail the row with a reason on its card — that is the guard working, not a bug.

### How processing runs

Creating a batch queues its sets and fires `POST /api/batch/[id]/tick`. Each tick claims up to 3
sets, draws them (clipart → describe → style → a 600 px mockup per member), writes the results, and
then **calls itself again** if anything is left. Vercel caps a function at 300 s, so the chain of
short hops is what lets a 200-set batch finish. The gallery polls every 3 s while anything is
`queued` or `processing`.

**"Lanjutkan"** is the manual restart. A tick that dies mid-set leaves its rows claimed in
`processing`, where no later tick will pick them up; a tick that dies before its roll-up leaves the
batch open with nothing left to do. "Lanjutkan" requeues claims older than 10 minutes, starts a
fresh chain, and closes a batch that is already finished. The gallery offers it whenever work is
outstanding, and says so loudly once nothing has changed for ten minutes.

One member's render failure is that member's failure: the card keeps the rest of the family and
badges the broken one. A whole set fails only when its clipart or style cannot be had, and the card
then carries the reason in Indonesian.

### Export

Approve the sets you want ("Setujui" per card, or tick several and use "Setujui terpilih"), then
"Buat ZIP". The export streams straight into Blob storage while it renders, so nothing accumulates
in memory, and the gallery shows "Unduh ZIP" when the file is there. Layout:

```
KEI/Ayah.png          # <sku_prefix or kid_name>/<member label>.png
KEI/Mama.png          # 300 DPI, transparent, cropped to the artwork + 1% margin
KEI/Keisya.png
BIM/Bima.png
report.csv            # set_id, folder, kid_name, member, status, error — one row per member
```

`report.csv` is the audit trail: every member that made it, every one that did not and why, and a
`truncated` row if the export ran out of time. Read it before sending anything to print — a ZIP with
holes still looks like a ZIP. Only approved sets are exported; the batch ZIP holds print PNGs only
(the per-set export at `/set/[id]` is the one that also gives you mockup JPEGs).

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

- **One database for all three environments.** Production, preview and development share the Neon
  project `neon-cinnabar-mirror`, so a local `pnpm dev` writes rows the shop's deployment shows and
  `pnpm db:migrate` migrates production. Splitting it needs the Neon console and cannot be done from
  a CLI here: the project is Vercel-marketplace-managed (`vercel integration-resource inspect
  neon-cinnabar-mirror` shows it connected to production, preview *and* development), and `neonctl`
  only authenticates through an interactive browser flow. The click-path: open
  <https://vercel.com/ganeshaampuh/~/stores/integration/store_zl4jKxlLxoYITybV> → **Open in Neon** →
  **Branches** → **New Branch** from the default branch, named `preview`, then again named
  `development`. Copy each branch's *pooled* connection string,
  then per environment `vercel env rm DATABASE_URL preview` / `vercel env add DATABASE_URL preview`
  (and the same for `development`), `vercel env pull .env.local`, and `pnpm db:migrate` to put the
  schema on the development branch.
- **An export much above ~120 sets comes back truncated.** The ZIP is one upload and cannot be split
  across function invocations, so it lives inside Vercel's 300 s ceiling: the exporter stops taking
  new sets 45 s before the deadline, closes a valid ZIP, writes a `truncated` row into `report.csv`
  and warns in the gallery header. At the measured ~2 s a set that lands somewhere past a hundred
  sets — well under the 200 the parser allows. Approving and exporting in slices is the workaround;
  part-ZIPs (`part-1.zip`, `part-2.zip`, each with its own report) are the follow-up.
- **The batch ZIP has no mockups.** It carries print PNGs and `report.csv` only. Mockup JPEGs come
  from the single-set export at `/set/[id]`.
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
