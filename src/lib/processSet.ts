import {
  applyOverrides,
  boundingBoxCm,
  collage,
  SetInputSchema,
  type Member,
  type TemplateContext,
  type SetInput,
  type SetStyle,
  type TextMeasurer,
} from "@/engine";
import { defaultShirtFor, loadShirtAsset, renderMockup, type RenderOpts } from "@/engine/server";
import { chooseStyle, describeClipart, generateClipart, type AIProvider } from "@/ai";
import type { SetRow } from "@/db/schema";
import type { putBlob } from "@/lib/blob";
import { initialStates, setMemberState, type MemberStates } from "@/lib/memberState";
import { RemoteImageError } from "@/lib/remoteImage";
import { clipartSize, guardRemoteImages, newByteCache } from "@/lib/sets";

/** Sets claimed per tick, matching spec §8.2 concurrency. */
export const TICK_BATCH = 3;

/**
 * How long a tick is allowed to run, in seconds — the route's `maxDuration`.
 *
 * 300 s is Vercel's function ceiling on every plan, and a live tick of three sets was measured at
 * 101 s: the previous 60 s would have killed it mid-set, leaving its claimed rows stranded in
 * `processing` and every partial render paid for twice. `TICK_BATCH` stays at three rather than
 * shrinking, because fewer sets per tick only buys more chain hops, each with its own cold start.
 */
export const TICK_MAX_SECONDS = 300;

/**
 * How old a claim must be before a resume calls it abandoned and requeues it.
 *
 * Derived from the budget rather than written down, because the two are one argument: a live tick's
 * row can be as old as the whole budget, so a shorter window would let a resume hand a set to a
 * second function while the first is still drawing it — the same set rendered, stored and billed
 * twice. Twice the budget keeps that margin whatever the budget becomes.
 */
export const STALE_CLAIM_MINUTES = Math.ceil((TICK_MAX_SECONDS * 2) / 60);

/** The width the gallery shows a member preview at (spec §8.2). */
export const PREVIEW_WIDTH = 600;

export type ProcessDeps = {
  provider: AIProvider;
  putBlob: typeof putBlob;
  measure: TextMeasurer;
  loadImage: RenderOpts["loadImage"];
};

/**
 * The columns this function reads. A whole `SetRow` satisfies it, which is what the tick route
 * hands over; a test can build one without inventing timestamps.
 */
export type ProcessRow = Pick<SetRow, "id" | "input" | "style" | "memberStates">;

/**
 * `style` is null only on a failed set, where there is nothing to write — the route leaves whatever
 * style the row already had in place rather than blanking it.
 */
export type ProcessResult = {
  style: SetStyle | null;
  aiFallback: boolean;
  memberStates: MemberStates;
  status: "ready" | "failed";
  error?: string;
};

const INVALID_INPUT = "Data set ini tidak valid, perbaiki barisnya di CSV.";
const CLIPART_FAILED = "Gagal membuat clipart untuk tema ini.";
const CLIPART_UNREADABLE = "Clipart-nya tidak bisa dibaca.";
const MEMBER_FAILED = "Gagal membuat preview untuk anggota ini.";

/** A whole-set failure: every member carries the same reason, so the gallery can explain each card. */
function failSet(memberIds: string[], error: string): ProcessResult {
  let states = initialStates(memberIds);
  for (const id of memberIds) states = setMemberState(states, id, { status: "failed", error });
  return { style: null, aiFallback: false, memberStates: states, status: "failed", error };
}

/** An expected failure's Indonesian sentence: a refused image already carries its own. */
const reason = (e: unknown, fallback: string) => (e instanceof RemoteImageError ? e.message : fallback);

/**
 * One set, end to end: clipart → describe → style → a 600 px mockup per member.
 *
 * It never throws for an expected failure and it never touches the database — the tick route owns
 * every read and write, so this stays a unit-testable function of a row plus its dependencies. That
 * split is also what keeps a broken set from aborting the batch: a failure comes back as a `failed`
 * status with a reason, and the route writes it like any other result.
 */
export async function processSet(row: ProcessRow, deps: ProcessDeps): Promise<ProcessResult> {
  const parsed = SetInputSchema.safeParse(row.input);
  if (!parsed.success) {
    // The member ids come from the row's own states, because the input they were built from is the
    // thing that failed to parse.
    return failSet(Object.keys(row.memberStates ?? {}), INVALID_INPUT);
  }
  const input: SetInput = parsed.data;
  const memberIds = input.members.map(m => m.id);

  // One cache for the whole set: the clipart is read for its metadata, for its size and then once
  // per member, and a remote src must not be fetched six times over.
  const cache = newByteCache();

  let src = input.clipartSrc ?? row.style?.clipartSrc ?? null;
  if (!src) {
    try {
      src = (await generateClipart(input.theme, { provider: deps.provider, putBlob: deps.putBlob })).url;
    } catch (e) {
      return failSet(memberIds, reason(e, CLIPART_FAILED));
    }
  }

  let style: SetStyle, aiFallback: boolean, ctx: TemplateContext;
  try {
    // Both reads go through the guarded door: in batch mode `src` came out of a spreadsheet.
    const meta = await describeClipart(src, { provider: deps.provider, cache });
    const size = await clipartSize(src, cache);
    // `chooseStyle` answers with the fallback style rather than throwing when the LLM is down.
    ({ style, aiFallback } = await chooseStyle(input, { url: src, meta }, { provider: deps.provider }));
    ctx = { measure: deps.measure, clipart: size };
  } catch (e) {
    return failSet(memberIds, reason(e, CLIPART_UNREADABLE));
  }

  const loadImage = guardRemoteImages(deps.loadImage, cache);
  let states = initialStates(memberIds);
  for (const member of input.members) {
    try {
      states = setMemberState(states, member.id, await renderMember({ input, style }, member, ctx, loadImage, deps, row.id));
    } catch (e) {
      // Spec §11: one member's render error is that member's error. The set stays ready, and the
      // gallery shows a badge on the card instead of losing the whole family.
      console.error(`[processSet] member ${member.id} of set ${row.id} failed:`, e instanceof Error ? e.message : e);
      states = setMemberState(states, member.id, { status: "failed", error: reason(e, MEMBER_FAILED) });
    }
  }

  return { style, aiFallback, memberStates: states, status: "ready" };
}

/** Renders one member's mockup, stores it, and reports the printed size the gallery labels it with. */
async function renderMember(
  set: { input: SetInput; style: SetStyle },
  member: Member,
  ctx: TemplateContext,
  loadImage: RenderOpts["loadImage"],
  deps: ProcessDeps,
  setId: string,
) {
  // Built per member rather than through `expand`, which maps them all at once: an override that
  // breaks one design must not take the other members down with it.
  const design = applyOverrides(collage(set, member, ctx), member.overrides);
  const shirt = await loadShirtAsset(defaultShirtFor(design.sizeClass));
  const jpg = await renderMockup(design, shirt, { loadImage, width: PREVIEW_WIDTH });
  const previewUrl = await deps.putBlob(`previews/${setId}-${member.id}-${Date.now()}.jpg`, jpg, "image/jpeg");
  const { w, h } = boundingBoxCm(design);
  return { status: "ready" as const, previewUrl, widthCm: w, heightCm: h };
}
