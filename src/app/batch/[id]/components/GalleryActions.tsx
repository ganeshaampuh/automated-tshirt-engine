"use client";

import { Button } from "@/app/components/ui";

/**
 * The bulk rail above the cards. It only ever talks about sets that are `ready`: those are the only
 * ones a tick has finished and the only ones an approval may move.
 */
export function GalleryActions({
  readyCount,
  selected,
  pending,
  onSelectAll,
  onClear,
  onApprove,
}: {
  readyCount: number;
  selected: number;
  pending: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onApprove: () => void;
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
      </div>
    </div>
  );
}
