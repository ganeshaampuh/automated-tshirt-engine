"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { deleteBatchAction, deleteSetsAction } from "@/app/actions/batches";
import { batchDeletable, isUnderway } from "@/app/batch/[id]/galleryRules";
import { ConfirmButton, useAction, useToast } from "@/app/components/ui";

/**
 * The delete on one row of the home page's lists.
 *
 * A client island rather than part of the page: everything around it is server-rendered from the
 * database, and only this button needs a browser. It is rendered as a *sibling* of the row's link,
 * never inside it — a destructive control nested in a navigation target is a misclick that both
 * navigates and deletes.
 *
 * The button is left out entirely, rather than disabled, for a row nothing can be done to: the
 * actions refuse a working batch outright and there is no retry on this page to reach, so a greyed
 * button would only raise a question the list cannot answer. The bench page says the same thing in
 * a sentence; a list of thirty rows has no room for thirty of them.
 */
export function RowDelete({ kind, id, name, status }: { kind: "batch" | "set"; id: string; name: string; status: string }) {
  const router = useRouter();
  const { show } = useToast();
  const { pending, run } = useAction();

  // The column keeps its width even with no button in it. A row that cannot be deleted would
  // otherwise let the link stretch into the gap, and the dates down the list stop lining up.
  const slot = (children: ReactNode) => <div className="flex min-w-[64px] shrink-0 justify-end">{children}</div>;

  if (kind === "batch" ? !batchDeletable(status) : isUnderway(status)) return slot(null);

  return slot(
    <ConfirmButton
      testId={`delete-${kind}-row`}
      confirm="Hapus?"
      pending={pending !== null}
      title={kind === "batch" ? `Hapus batch ${name} beserta semua setnya` : `Hapus ${name} untuk selamanya`}
      onConfirm={() =>
        run("delete", async () => {
          const res = kind === "batch" ? await deleteBatchAction(id) : await deleteSetsAction([id]);
          if (!res.ok) return res;
          // A batch reports the sets it took with it; a set reports whether it went at all, and a
          // zero there means the row was claimed by a tick between the render and the click.
          if (kind === "set" && res.data.deleted === 0) {
            show("Set ini sedang diproses, tidak bisa dihapus sekarang.");
          } else {
            show(kind === "batch" ? `Batch ${name} dihapus.` : `${name} dihapus.`, "ok");
          }
          router.refresh();
        })
      }
    >
      Hapus
    </ConfirmButton>,
  );
}
