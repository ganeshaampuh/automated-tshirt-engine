import { type BatchStatus, type SetStatus } from "@/lib/memberState";

/**
 * The Indonesian word for each status, and the fallback for one the vocabulary has not caught up
 * with: an unknown status is shown as itself rather than blanked, so a row is never silently
 * unlabelled.
 *
 * Shared rather than kept on the home page because the card view needs the same words as the row
 * view, and two lists spelling one status differently is the bug this prevents.
 */
const SET: Record<SetStatus, string> = {
  draft: "Draft",
  queued: "Antrean",
  processing: "Diproses",
  ready: "Siap",
  approved: "Disetujui",
  rejected: "Ditolak",
  failed: "Gagal",
};

const BATCH: Record<BatchStatus, string> = {
  processing: "Diproses",
  ready: "Siap",
  exporting: "Diekspor",
  exported: "Selesai",
  failed: "Gagal",
};

export const statusLabel = (status: string): string => (status in SET ? SET[status as SetStatus] : status);

export const batchStatusLabel = (status: string): string => (status in BATCH ? BATCH[status as BatchStatus] : status);
