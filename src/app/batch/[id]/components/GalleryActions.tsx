"use client";

import { Button, ConfirmButton } from "@/app/components/ui";

/**
 * The bulk rail above the cards.
 *
 * It talks about two different selections drawn from the same ticked boxes. An approval may only
 * move a `ready` set, so that button counts those; a delete reaches every settled set, failed and
 * rejected included, which is most of what a shop actually wants to clear out. The rail reports the
 * wider of the two, because that is how many boxes are ticked and doing anything else makes the
 * count look broken.
 */
export function GalleryActions({
  readyCount,
  approvedCount,
  selected,
  removable,
  pending,
  deleting,
  exporting,
  exportStale,
  zipUrl,
  onSelectAll,
  onClear,
  onApprove,
  onDelete,
  onExport,
}: {
  readyCount: number;
  approvedCount: number;
  /** Ticked boxes an approval may move: the `ready` ones. */
  selected: number;
  /** Ticked boxes a delete may remove: every settled one, so never fewer than `selected`. */
  removable: number;
  pending: boolean;
  deleting: boolean;
  exporting: boolean;
  /** The export has outlived the route that could have written it; the run may be started again. */
  exportStale: boolean;
  zipUrl: string | null;
  onSelectAll: () => void;
  onClear: () => void;
  onApprove: () => void;
  onDelete: () => void;
  onExport: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-rule px-1 py-3">
      <p className="text-[13px] text-muted" data-testid="selection-count">
        {removable > 0 ? `${removable} set dipilih` : `${readyCount} set menunggu diperiksa`}
      </p>
      <div className="ml-auto flex flex-wrap gap-1.5">
        {removable > 0 ? (
          <Button variant="quiet" onClick={onClear}>
            Bersihkan pilihan
          </Button>
        ) : (
          <Button onClick={onSelectAll} disabled={readyCount === 0}>
            Pilih semua yang siap
          </Button>
        )}
        <Button variant="primary" data-testid="approve-selected" disabled={selected === 0} pending={pending} onClick={onApprove}>
          Setujui terpilih
        </Button>
        {/* Offered only once something is ticked. A delete rail standing permanently beside the
            approve button invites the misclick it cannot undo. */}
        {removable > 0 && (
          <ConfirmButton
            testId="delete-selected"
            confirm={removable === 1 ? "Hapus 1 set?" : `Hapus ${removable} set?`}
            pending={deleting}
            onConfirm={onDelete}
          >
            Hapus terpilih
          </ConfirmButton>
        )}
        {/* The ZIP is only worth offering once something is in it, and the link says nothing about
            how many sets are inside: a truncated export would otherwise be labelled with the number
            the shop approved rather than the number the file actually holds. It is hidden while an
            export is running, so nobody downloads the previous file believing it holds today's
            approvals — but it comes back once that export is stale, because then the file on the
            row is all the shop has. Having a link never removes the button: an export that came out
            short, and a set approved after the file was written, both need a second run. */}
        {approvedCount > 0 && zipUrl !== null && (!exporting || exportStale) && (
          <a
            href={zipUrl}
            download
            data-testid="download-zip"
            className="inline-flex items-center rounded-md border border-rule px-3 py-1.5 text-[13px] font-medium transition-colors hover:bg-panel"
          >
            Unduh ZIP
          </a>
        )}
        {/* Disabled only while an export can still be alive. A batch left at `exporting` by a kick
            that never arrived has no other way back, so past the stale window the button works
            again and says so — this is the one affordance that reaches the action's own retry. */}
        {approvedCount > 0 && (
          <Button
            data-testid="export-zip"
            pending={exporting && !exportStale}
            disabled={exporting && !exportStale}
            onClick={onExport}
          >
            {exporting ? (exportStale ? "Coba buat ZIP lagi" : "Menyiapkan ZIP…") : zipUrl === null ? "Buat ZIP" : "Buat ulang ZIP"}
          </Button>
        )}
      </div>
    </div>
  );
}
