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
        {/* The ZIP is only worth offering once something is in it, and once it exists the same slot
            becomes the file itself rather than a second button that would start the render again. */}
        {approvedCount > 0 &&
          (zipUrl && !exporting ? (
            <a
              href={zipUrl}
              download
              data-testid="download-zip"
              className="inline-flex items-center rounded-md border border-rule px-3 py-1.5 text-[13px] font-medium transition-colors hover:bg-panel"
            >
              Unduh ZIP ({approvedCount} set)
            </a>
          ) : (
            <Button data-testid="export-zip" pending={exporting} disabled={exporting} onClick={onExport}>
              {exporting ? "Menyiapkan ZIP…" : "Buat ZIP"}
            </Button>
          ))}
      </div>
    </div>
  );
}
