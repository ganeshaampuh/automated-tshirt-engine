import type { ProcessResult, ProcessRow } from "@/lib/processSet";

/**
 * The files a tick uploaded for one set that now belongs to nobody.
 *
 * A delete no longer waits for the server to go idle (see `deletable` in
 * `src/app/batch/[id]/galleryRules.ts`), so a tick can finish rendering a set whose row was removed
 * while it worked. Its database writes land on nothing by themselves — they are all keyed on the
 * row or on `status = 'processing'` — but its uploads are already in Blob storage with no row left
 * to point at them. This names those, and `src/app/api/batch/[id]/tick/route.ts` hands them to
 * `deleteBlobs`.
 *
 * Only what this tick actually put there. The previews always qualify: `renderMember` uploads one
 * per member on the spot. The clipart qualifies only when the tick generated it — a row that
 * arrived with its own `clipartSrc` is carrying a file the shop supplied, and deleting that would
 * aim a delete at a store that never held it. Comparing the two `clipartSrc` values is what tells
 * the cases apart: they differ exactly when the tick minted a new one.
 */
export function orphanBlobs(row: ProcessRow, out: ProcessResult): string[] {
  const urls = Object.values(out.memberStates)
    .map(state => state.previewUrl)
    .filter((url): url is string => typeof url === "string" && url !== "");
  const clipart = out.style?.clipartSrc;
  if (clipart && clipart !== row.input.clipartSrc) urls.push(clipart);
  return urls;
}
