"use client";

import { boundingBoxCm, isWithinSafeArea, maxCm, type Design } from "@/engine";

const cm = (n: number) => n.toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** The printed size of the current member, in the units the shop actually talks in. */
export function SizeReadout({ design }: { design: Design | null }) {
  if (!design) {
    return <div className="h-9 border-t border-rule bg-panel" />;
  }
  const { w, h } = boundingBoxCm(design);
  const safe = isWithinSafeArea(design);
  return (
    <div className="flex items-center gap-3 border-t border-rule bg-panel px-4 py-2" data-testid="size-readout">
      <span className="font-mono text-[13px] tabular-nums">
        {cm(w)} × {cm(h)} cm
      </span>
      <span className="text-[12px] text-muted">max {maxCm(design.sizeClass)} cm</span>
      {!safe && <span className="ml-auto text-[12px] font-medium text-alert">Layer keluar dari area aman</span>}
    </div>
  );
}
