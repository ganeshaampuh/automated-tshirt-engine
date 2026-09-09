"use client";

import Link from "next/link";
import { Button } from "@/app/components/ui";
import { progressFraction, progressLine, isBusy, type GalleryCounts } from "../galleryRules";

/**
 * The bench's header: what the batch is, how far it has got, and — only while something is still
 * moving — the manual restart. The bar is a strip of cutting-mat green filling left to right, the
 * one saturated surface the workbench allows itself outside the artwork.
 */
export function StatusBar({
  name,
  counts,
  stuck,
  resuming,
  onResume,
}: {
  name: string;
  counts: GalleryCounts;
  stuck: boolean;
  resuming: boolean;
  onResume: () => void;
}) {
  const busy = isBusy(counts);
  const pct = Math.round(progressFraction(counts) * 100);

  return (
    <header className="sticky top-0 z-20 border-b border-rule bg-panel">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-6 pt-3 pb-2">
        <Link href="/" className="font-display text-[13px] text-muted transition-colors hover:text-ink">
          ← Kembali
        </Link>
        <h1 className="truncate font-display text-[17px] font-medium">{name}</h1>
        <p data-testid="progress-line" className="text-[13px] text-muted">
          {progressLine(counts)}
        </p>
        {busy && !stuck && (
          <span className="flex items-center gap-2 text-[13px] text-muted">
            <span aria-hidden className="size-3 animate-spin rounded-full border-2 border-mat border-t-transparent" />
            {counts.processing > 0 ? "Sedang menggambar…" : "Menunggu giliran…"}
          </span>
        )}
        {stuck && (
          <p data-testid="stuck" className="text-[13px] text-alert">
            Tidak ada yang bergerak beberapa menit. Tekan “Lanjutkan” untuk menjalankan sisanya.
          </p>
        )}
        {busy && (
          <Button
            className="ml-auto"
            variant={stuck ? "primary" : "default"}
            data-testid="resume"
            pending={resuming}
            onClick={onResume}
            title="Mulai lagi kalau tidak ada yang bergerak beberapa menit"
          >
            Lanjutkan
          </Button>
        )}
      </div>
      <div
        className="h-1 w-full bg-bench"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Kemajuan batch"
      >
        <div className="h-full bg-mat transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
    </header>
  );
}
