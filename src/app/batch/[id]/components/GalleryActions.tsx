"use client";

import { Button } from "@/app/components/ui";

/**
 * The bulk rail above the cards. It only ever talks about sets that are `ready`: those are the only
 * ones a tick has finished and the only ones an approval may move.
 */
export function GalleryActions({
  readyCount,
  approvedCount,
  selected,
  pending,
  exporting,
  exportStale,
  zipUrl,
  onSelectAll,
  onClear,
  onApprove,
  onExport,
}: {
  readyCount: number;
  approvedCount: number;
  selected: number;
  pending: boolean;
  exporting: boolean;
  /** The export has outlived the route that could have written it; the run may be started again. */
  exportStale: boolean;
  zipUrl: string | null;
  onSelectAll: () => void;
  onClear: () => void;
  onApprove: () => void;
  onExport: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-rule px-1 py-3">
      <p className="text-[13px] text-muted" data-testid="selection-count">
        {selected > 0 ? `${selected} set dipilih` : `${readyCount} set menunggu diperiksa`}
      </p>
      <div className="ml-auto flex flex-wrap gap-1.5">
        {selected > 0 ? (
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
