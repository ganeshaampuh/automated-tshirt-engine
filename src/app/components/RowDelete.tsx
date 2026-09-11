"use client";

import { useRouter } from "next/navigation";
import { deleteBatchAction, deleteSetsAction } from "@/app/actions/batches";
import { isUnderway } from "@/app/batch/[id]/galleryRules";
import { ConfirmButton, useAction, useToast } from "@/app/components/ui";

/**
 * The delete on one row of the home page's lists.
 *
 * A client island rather than part of the page: everything around it is server-rendered from the
 * database, and only this button needs a browser. It is rendered as a *sibling* of the row's link,
 * never inside it — a destructive control nested in a navigation target is a misclick that both
 * navigates and deletes.
 *
 * Every row gets one, a batch or a set still being drawn included: deleting is also how a shop
 * cancels work it no longer wants, and the row that most needs cancelling is exactly the one that
 * is busy. The confirm label is what changes — a row still in flight says so, because in a list of
 * thirty there is no room for a sentence explaining it.
 */
export function RowDelete({
  kind,
  id,
  name,
  status,
}: {
  kind: "batch" | "set";
  id: string;
  name: string;
  status: string;
}) {
  const router = useRouter();
  const { show } = useToast();
  const { pending, run } = useAction();

  // A fixed-width column, so the arming label being longer than "Hapus?" cannot shove the dates
  // down the list out of line.
  return (
    <div className="flex min-w-[64px] shrink-0 justify-end">
      <ConfirmButton
        testId={`delete-${kind}-row`}
        // `isUnderway` covers a set's own busy statuses; `exporting` is the batch-only one.
        confirm={
          isUnderway(status) || status === "exporting"
            ? "Hentikan & hapus?"
            : "Hapus?"
        }
        pending={pending !== null}
        title={
          kind === "batch"
            ? `Hapus batch ${name} beserta semua setnya`
            : `Hapus ${name} untuk selamanya`
        }
        onConfirm={() =>
          run("delete", async () => {
            const res =
              kind === "batch"
                ? await deleteBatchAction(id)
                : await deleteSetsAction([id]);
            if (!res.ok) return res;
            // A batch reports the sets it took with it; a set reports whether it went at all, and a
            // zero there now means only one thing: another tab deleted the row first.
            if (kind === "set" && res.data.deleted === 0) {
              show("Set ini sudah tidak ada. Muat ulang halaman.");
            } else {
              show(
                kind === "batch"
                  ? `Batch ${name} dihapus.`
                  : `${name} dihapus.`,
                "ok",
              );
            }
            router.refresh();
          })
        }
      >
        Hapus
      </ConfirmButton>
    </div>
  );
}
