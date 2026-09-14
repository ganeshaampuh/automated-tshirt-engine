import type { MemberStates } from "@/lib/memberState";
import type { SetInput, SetStyle, SizeClass } from "@/engine";

/**
 * The flat backdrop a rendered mockup is laid on.
 *
 * `renderMockup` flattens onto this before writing its JPEG, so a thumbnail has to paint the same
 * colour behind the blank shirt — that shirt is drawn through a mask, and whatever shows in the
 * margins around it must match what a rendered card shows there, or the two kinds of card read as
 * two different surfaces in one grid.
 *
 * It lives here rather than in `src/engine/mockup.ts` because that module pulls in `sharp` and
 * cannot be imported by a page; `mockup.ts` imports it from here instead, so there is one definition.
 */
export const MOCKUP_BACKDROP = "#f3f3f3";

/** The two shirt assets in `public/mockups`. */
export type ShirtId = "adult-flat" | "kids-flat";

/**
 * Which silhouette a size class wears.
 *
 * The same rule as `defaultShirtFor` in `src/engine/mockup.ts`, which cannot be imported outside the
 * server: that module pulls in `sharp` and the filesystem. This copy is the one the browser and the
 * page share, and it is the only one either of them may use.
 */
export const shirtId = (sizeClass: SizeClass): ShirtId => (sizeClass === "adult" ? "adult-flat" : "kids-flat");

/**
 * What a set's thumbnail shows, in the order the three cases are worth spending anything on.
 *
 * `mockup` is a file the batch pipeline already uploaded — see `renderMember` in
 * `src/lib/processSet.ts`, the only writer of `previewUrl`. It wins outright: the picture exists, and
 * re-drawing it would spend CPU to arrive at the same image.
 *
 * `render` is a set that carries a style, which is everything needed to draw its design. The card
 * points an `<img>` at `/api/set/[id]/preview` and that route does the drawing, off the page's own
 * render — fourteen `sharp` composites inside a server render would stall the home page for seconds,
 * where fourteen lazy image requests do not. The URL carries the row's `updatedAt` so the response
 * can be cached forever and an edit still moves the picture: a new version is simply a new URL.
 *
 * `blank` is everything left — a set nobody has styled yet, where there is no design to draw at all.
 * The blank shirt travels with the `render` case too, as the fallback `ShirtThumb` paints underneath
 * it, so a render still in flight or one that failed shows an empty shirt and not a broken image.
 *
 * The preview read is the birthday kid's and no one else's. A batch set is drawn member by member,
 * so the family can be finished while the kid is not, and the card is about the kid's shirt — taking
 * whichever preview happened to land first would quietly show Ayah's design under Keisya's name.
 *
 * `null` in, `null` out: the home page renders rows whose stored input will not parse, and those are
 * exactly the rows a shop needs to be able to delete. A thumbnail must not be what 500s the page.
 */
export type SetPreview =
  | { kind: "mockup"; url: string }
  | { kind: "render"; url: string; shirt: ShirtId; color: string }
  | { kind: "blank"; shirt: ShirtId; color: string };

/** The columns a thumbnail is chosen from — a whole `SetRow` satisfies it once its input is parsed. */
export type PreviewSource = {
  id: string;
  input: SetInput | null;
  style: SetStyle | null;
  memberStates: MemberStates | null;
  updatedAt: Date;
};

export function setPreview(row: PreviewSource): SetPreview | null {
  const { input } = row;
  if (!input) return null;
  // `SetInputSchema` guarantees exactly one birthday kid, so this only falls back for input that
  // arrived unparsed — and the caller has already handled that with the `null` above.
  const kid = input.members.find(m => m.kind === "birthday-kid") ?? input.members[0];
  const url = row.memberStates?.[kid.id]?.previewUrl;
  if (url) return { kind: "mockup", url };

  const blank = { shirt: shirtId(kid.sizeClass), color: input.shirtColor };
  if (!row.style) return { kind: "blank", ...blank };
  return { kind: "render", url: `/api/set/${row.id}/preview?v=${row.updatedAt.getTime()}`, ...blank };
}
