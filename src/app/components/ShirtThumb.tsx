import { MOCKUP_BACKDROP, type SetPreview } from "@/lib/setPreview";

/**
 * Both shirt assets are 2400 × 2600, and `renderMockup` writes its preview at those same
 * proportions — which is what lets the drawn and the blank case share one frame without either
 * being letterboxed or scaled differently from the other.
 */
const SHIRT_ASPECT = "12 / 13";

/**
 * The thumbnail is square and the shirt is cropped to it rather than fitted inside it.
 *
 * Fitting would letterbox an already margin-heavy asset — the shirt does not fill its own PNG — and
 * a grid of thirty of those is mostly empty. The sleeves reach nearly the full width, so the crop
 * can only come off the top and bottom, which is exactly where the slack is.
 */
const BOX = "1 / 1";

/**
 * A set's thumbnail: its design on a shirt, or an empty shirt in the set's own colour.
 *
 * A server component with no JavaScript of its own. The blank shirt is the trick the editor's canvas
 * already uses (`CanvasPanel.tsx`): the shirt PNG is a mask over a plain coloured box, and the
 * asset's shading is laid over the result with `mix-blend-multiply`, so a flat hex comes out looking
 * like cloth with folds. It costs one cached image request per page rather than a render.
 *
 * A drawn shirt is stacked *over* that, never instead of it, so the empty shirt is what shows while
 * a render is still in flight — and what the shop keeps seeing when that render had nothing to draw,
 * since `/api/set/[id]/preview` answers with a transparent pixel rather than an error the browser
 * would paint a broken icon for.
 *
 * Both layers live inside one frame at the asset's own proportions, and that is what makes them line
 * up: cropping each against the square separately would shift the drawn shirt off the blank one.
 */
export function ShirtThumb({ preview, alt }: { preview: SetPreview | null; alt: string }) {
  if (!preview) {
    return (
      <div className="grid place-items-center text-[12px] text-muted" style={{ aspectRatio: BOX, backgroundColor: MOCKUP_BACKDROP }}>
        —
      </div>
    );
  }

  // A stored mockup is a file that already exists, so nothing needs painting behind it; a render is a
  // request that may still be running, and the blank shirt is what stands in until it lands.
  const blank = preview.kind === "mockup" ? null : preview;
  const drawn = preview.kind === "blank" ? null : preview.url;

  return (
    <div
      className="relative w-full overflow-hidden"
      style={{ aspectRatio: BOX, backgroundColor: MOCKUP_BACKDROP }}
      role="img"
      aria-label={alt}
    >
      {/* The asset at its own proportions, overflowing the square it is cropped to. Lifted off
          centre because the shirt does not sit centred in its own PNG: there is roughly 19% of empty
          frame above the collar and 7% below the hem, so a centred crop leaves the hem flush against
          the bottom edge with a band of grey over the collar. The offset spends the crop on the
          empty end instead. */}
      <div className="absolute inset-x-0 top-1/2 -translate-y-[57%]" style={{ aspectRatio: SHIRT_ASPECT }}>
        {blank && (
          <>
            <div
              className="absolute inset-0"
              style={{
                backgroundColor: blank.color,
                maskImage: `url(/mockups/${blank.shirt}.png)`,
                maskSize: "100% 100%",
                WebkitMaskImage: `url(/mockups/${blank.shirt}.png)`,
                WebkitMaskSize: "100% 100%",
              }}
            />
            {/* eslint-disable-next-line @next/next/no-img-element -- a static asset the editor loads the same way */}
            <img src={`/mockups/${blank.shirt}-shade.png`} alt="" className="absolute inset-0 size-full mix-blend-multiply" />
          </>
        )}
        {drawn && (
          // `lazy` is what keeps the render case affordable: only the cards actually scrolled to ever
          // ask the route to draw anything.
          // eslint-disable-next-line @next/next/no-img-element -- one is a blob URL, the other our own route; both are already sized
          <img src={drawn} alt="" loading="lazy" decoding="async" className="absolute inset-0 size-full" />
        )}
      </div>
    </div>
  );
}
