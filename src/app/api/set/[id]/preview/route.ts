import { applyOverrides, collage, SetInputSchema, SetStyleSchema, type TemplateContext } from "@/engine";
import { createNodeMeasurer, defaultShirtFor, loadImageFromFile, loadShirtAsset, renderMockup } from "@/engine/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { clipartSize, guardRemoteImages, newByteCache } from "@/lib/sets";

const { sets } = schema;

export const dynamic = "force-dynamic";

/**
 * A render is a `sharp` composite plus, for a remote clipart, one fetch. Well inside the default,
 * but stated so a cold start registering fonts is never what kills the request.
 */
export const maxDuration = 60;

/**
 * Wide enough for a card on a 2× screen and no wider.
 *
 * The gallery's `PREVIEW_WIDTH` is 600 because those previews are looked at closely; a thumbnail in
 * a three-column grid is about 220 CSS px, and rendering more than this would be paying for pixels
 * the page then throws away on every card.
 */
const CARD_WIDTH = 480;

/** A year, the longest `max-age` worth writing. The URL carries the row's version, so it is safe. */
const FOREVER = "public, max-age=31536000, immutable";

/** Short, so a set that failed to draw is tried again soon rather than being cached as broken. */
const RETRY_SOON = "public, max-age=60";

/**
 * A 1 × 1 transparent GIF, the answer to every case that cannot produce a picture.
 *
 * Not a 404 and not a 500: the card points a plain `<img>` at this route, and a failed response
 * paints the browser's broken-image icon over the blank shirt `ShirtThumb` draws underneath. An
 * empty pixel lets that shirt show through instead, which is exactly the fallback the card was built
 * around — the shop sees a set with no artwork yet, which is the truth, rather than an error glyph.
 */
const BLANK_GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

function blank(status: number) {
  return new Response(new Uint8Array(BLANK_GIF), {
    status,
    headers: { "Content-Type": "image/gif", "Cache-Control": RETRY_SOON },
  });
}

/**
 * The birthday kid's shirt, drawn on demand, for the home page's card thumbnails.
 *
 * The same four steps `renderMember` takes in `src/lib/processSet.ts` — collage, overrides, shirt
 * asset, mockup — but nothing is stored: the answer is cached by URL instead. `setPreview` stamps
 * the row's `updatedAt` into the query string, so one render serves every view of a given version of
 * a set and an edit simply asks for a different URL. That is what keeps this off the write path:
 * no Blob upload per save, no orphaned preview to clean up, and no cost at all for a set nobody
 * scrolls past.
 *
 * This is a public GET keyed on a set id, like every other route here. The app has no accounts — see
 * the note in `approvable`, `src/app/batch/[id]/galleryRules.ts` — so that is the existing posture
 * rather than something this route opens up.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const row = await db.query.sets
    .findFirst({ where: eq(sets.id, id), columns: { input: true, style: true } })
    .catch(e => {
      console.error(`[preview] reading set ${id} failed:`, e instanceof Error ? e.message : e);
      return null;
    });
  if (!row) return blank(404);

  const input = SetInputSchema.safeParse(row.input);
  const style = SetStyleSchema.safeParse(row.style);
  // A set with no style has no design to draw; that is the blank shirt's whole job, not an error.
  if (!input.success || !style.success) return blank(200);

  const kid = input.data.members.find(m => m.kind === "birthday-kid") ?? input.data.members[0];

  try {
    // One cache for this render: the clipart is read for its size and then again by the renderer,
    // and a remote src must not be fetched twice for one thumbnail.
    const cache = newByteCache();
    const ctx: TemplateContext = {
      measure: createNodeMeasurer(),
      clipart: await clipartSize(style.data.clipartSrc, cache),
    };
    const design = applyOverrides(collage({ input: input.data, style: style.data }, kid, ctx), kid.overrides);
    const shirt = await loadShirtAsset(defaultShirtFor(design.sizeClass));
    const jpg = await renderMockup(design, shirt, {
      loadImage: guardRemoteImages(loadImageFromFile, cache),
      width: CARD_WIDTH,
    });
    return new Response(new Uint8Array(jpg), {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": FOREVER },
    });
  } catch (e) {
    // A clipart host that is down, a font that will not load, an override that breaks the design:
    // every one of them is a thumbnail the shop can live without, and none is worth a 500 on a page
    // that is showing thirty other sets.
    console.error(`[preview] rendering set ${id} failed:`, e instanceof Error ? e.message : e);
    return blank(200);
  }
}
