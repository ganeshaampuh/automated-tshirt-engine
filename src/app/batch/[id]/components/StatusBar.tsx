"use client";

import Link from "next/link";
import { Button, ConfirmButton } from "@/app/components/ui";
import { deleteWarning, progressFraction, progressLine, isBusy, resumeOffered, type GalleryCounts } from "../galleryRules";

/**
 * The bench's header: what the batch is, how far it has got, and — only while something is still
 * moving — the manual restart. The bar is a strip of cutting-mat green filling left to right, the
 * one saturated surface the workbench allows itself outside the artwork.
 */
export function StatusBar({
  name,
  counts,
  batchStatus,
  notice,
  stuck,
  resuming,
  deleting,
  onResume,
  onDelete,
}: {
  name: string;
  counts: GalleryCounts;
  batchStatus: string;
  /** What the batch row has to say for itself — an export that came out short, or came out with holes. */
  notice: string | null;
  stuck: boolean;
  resuming: boolean;
  deleting: boolean;
  onResume: () => void;
  onDelete: () => void;
}) {
  const busy = isBusy(counts);
  // Every set settled while the batch row is still open: a tick died before its own roll-up, and
  // only a resume can close it.
  const wedged = !busy && batchStatus === "processing";
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
        {/* The batch's own sentence. Without it the only account of a short or holed export lives
            inside report.csv, which nobody opens unless they already suspect something. */}
        {notice !== null && notice !== "" && (
          <p data-testid="batch-notice" className="text-[13px] text-alert">
            {notice}
          </p>
        )}
        {stuck && (
          <p data-testid="stuck" className="text-[13px] text-alert">
            Tidak ada yang bergerak beberapa menit. Tekan “Lanjutkan” untuk menjalankan sisanya.
          </p>
        )}
        {wedged && (
          <p data-testid="wedged" className="text-[13px] text-alert">
            Semua set sudah selesai, tapi batch-nya belum ditutup. Tekan “Lanjutkan”.
          </p>
        )}
        {resumeOffered(counts, batchStatus) && (
          <Button
            className="ml-auto"
            variant={stuck || wedged ? "primary" : "default"}
            data-testid="resume"
            pending={resuming}
            onClick={onResume}
            title="Mulai lagi kalau tidak ada yang bergerak beberapa menit"
          >
            Lanjutkan
          </Button>
        )}
        {/* Always offered, whatever the batch is busy with: deleting is also how a shop cancels a
            batch it no longer wants drawn, so hiding the button while a tick runs would take the
            cancel away with it. What carries the warning instead is `deleteWarning`, which names
            the work the second click is about to stop. `ml-auto` on whichever of the two controls
            comes first keeps both pinned to the right. */}
        <ConfirmButton
          className={resumeOffered(counts, batchStatus) ? "" : "ml-auto"}
          testId="delete-batch"
          confirm={deleteWarning(counts, batchStatus)}
          pending={deleting}
          title="Hapus batch ini beserta semua setnya untuk selamanya"
          onConfirm={onDelete}
        >
          Hapus batch
        </ConfirmButton>
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
