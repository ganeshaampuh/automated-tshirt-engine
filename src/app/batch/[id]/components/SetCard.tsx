"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, ConfirmButton } from "@/app/components/ui";
import type { MemberStates } from "@/lib/memberState";
import type { GallerySet } from "../Gallery";

const LABEL: Record<string, string> = {
  queued: "Antre",
  processing: "Digambar",
  ready: "Siap dicek",
  approved: "Disetujui",
  rejected: "Ditolak",
  failed: "Gagal",
};

/** The verdict colours the card's left edge, so a wall of cards reads at arm's length. */
const EDGE: Record<string, string> = {
  approved: "bg-mat",
  failed: "bg-alert",
  rejected: "bg-rule",
};

export function SetCard({
  row,
  selected,
  pending,
  onSelect,
  onApprove,
  onReject,
  onRegenerate,
  onDelete,
}: {
  row: GallerySet;
  selected: boolean;
  pending: string | null;
  onSelect: (on: boolean) => void;
  onApprove: () => void;
  onReject: () => void;
  onRegenerate: (note: string) => void;
  onDelete: () => void;
}) {
  const [note, setNote] = useState<string | null>(null);
  const { kidName, age, theme } = row.input;
  const done = row.status === "approved" || row.status === "rejected";
  const busy = row.status === "queued" || row.status === "processing";

  return (
    <article data-testid="set-card" data-status={row.status} className="relative border border-rule bg-panel">
      <span aria-hidden className={`absolute inset-y-0 left-0 w-[3px] ${EDGE[row.status] ?? "bg-transparent"}`} />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-rule py-2.5 pr-3 pl-4">
        <input
          type="checkbox"
          className="size-4 accent-[var(--color-mat)]"
          checked={selected}
          // Not `ready`-only any more: the rail's delete reaches every settled set, and a batch full
          // of failures is exactly the selection a shop wants to make. Approval still filters itself.
          disabled={busy}
          aria-label={`Pilih set ${kidName}`}
          onChange={e => onSelect(e.target.checked)}
        />
        <h2 className="font-display text-[15px] font-medium">
          {kidName} <span className="text-muted">· {age} th</span>
        </h2>
        <p className="truncate text-[13px] text-muted">{theme}</p>
        <span
          data-testid="set-status"
          className={`ml-auto font-display text-[12px] ${
            row.status === "failed" ? "text-alert" : row.status === "approved" ? "text-mat" : "text-muted"
          }`}
        >
          {LABEL[row.status] ?? row.status}
        </span>
      </div>

      <MemberStrip members={row.input.members} states={row.memberStates} dim={done} />

      {row.error && (
        <p data-testid="set-error" className="border-t border-rule px-4 py-2 text-[13px] text-alert">
          {row.error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1.5 border-t border-rule px-4 py-2.5">
        {row.status === "ready" && (
          <Button variant="primary" data-testid="approve" pending={pending === `approve:${row.id}`} onClick={onApprove}>
            Setujui
          </Button>
        )}
        <Link
          href={`/set/${row.id}`}
          className="inline-flex items-center rounded-[var(--radius-ctl)] border border-rule bg-panel px-2.5 py-1.5 font-display text-[13px] leading-none hover:bg-bench"
        >
          Edit
        </Link>
        <Button data-testid="regenerate-open" disabled={busy} onClick={() => setNote(note === null ? "" : null)}>
          Buat ulang
        </Button>
        <Button variant="quiet" data-testid="reject" disabled={busy} pending={pending === `reject:${row.id}`} onClick={onReject}>
          Tolak
        </Button>
        {/* Pushed to the far end, away from Tolak: the two verdicts read alike in a hurry and only
            one of them can be taken back. Unlike its neighbours it stays live while the set is being
            drawn — a verdict on artwork that does not exist yet is meaningless, but calling off the
            drawing is exactly what a shop wants at that moment, and the label says so. */}
        <ConfirmButton
          className="ml-auto"
          testId="delete-set"
          confirm={busy ? `Hentikan & hapus ${kidName}?` : `Hapus ${kidName}?`}
          pending={pending === `delete:${row.id}`}
          title={busy ? `Hentikan penggambaran ${kidName} dan hapus setnya` : `Hapus set ${kidName} untuk selamanya`}
          onConfirm={onDelete}
        >
          Hapus
        </ConfirmButton>
      </div>

      {note !== null && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-rule bg-bench px-4 py-2.5">
          <input
            className="field flex-1"
            autoFocus
            value={note}
            placeholder="Catatan buat AI, misal “warnanya lebih terang” (boleh kosong)"
            aria-label={`Catatan untuk set ${kidName}`}
            onChange={e => setNote(e.target.value)}
          />
          <Button
            variant="primary"
            data-testid="regenerate"
            pending={pending === `regen:${row.id}`}
            onClick={() => {
              onRegenerate(note);
              setNote(null);
            }}
          >
            Gambar lagi
          </Button>
          <Button variant="quiet" onClick={() => setNote(null)}>
            Batal
          </Button>
        </div>
      )}
    </article>
  );
}

/** Every kaos of the set side by side, each on its own square of cutting mat, as the sample lays them out. */
function MemberStrip({
  members,
  states,
  dim,
}: {
  members: GallerySet["input"]["members"];
  states: MemberStates | null;
  dim: boolean;
}) {
  return (
    <div className={`flex flex-wrap gap-2 px-4 py-3 ${dim ? "opacity-60" : ""}`}>
      {members.map(m => {
        const state = states?.[m.id];
        return (
          <figure key={m.id} className="mat w-[152px] shrink-0 p-2">
            <div className="grid aspect-square place-items-center bg-panel">
              {state?.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- a blob URL of unknown host; the mockup is already sized at 600 px
                <img src={state.previewUrl} alt={`Mockup ${m.label}`} className="size-full object-contain" />
              ) : (
                <span className="text-[12px] text-muted">{state?.status === "failed" ? "Gagal" : "…"}</span>
              )}
            </div>
            <figcaption className="mt-2 truncate font-display text-[12px] text-white/85">{m.label}</figcaption>
            {state?.status === "failed" && (
              <p data-testid="member-error" className="mt-0.5 text-[11px] leading-tight text-[#ffb4a6]">
                {state.error ?? "Gagal digambar"}
              </p>
            )}
          </figure>
        );
      })}
    </div>
  );
}
