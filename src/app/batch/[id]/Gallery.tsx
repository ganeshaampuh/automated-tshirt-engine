"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { approveSetsAction, exportBatchAction, regenerateSetAction, rejectSetAction, resumeBatchAction } from "@/app/actions/batches";
import { ToastHost, useAction, useToast } from "@/app/components/ui";
import type { SetInput } from "@/engine";
import type { MemberStates } from "@/lib/memberState";
import { GalleryActions } from "./components/GalleryActions";
import { SetCard } from "./components/SetCard";
import { StatusBar } from "./components/StatusBar";
import { approvable, exportRetryable, galleryCounts, isBusy, statusSignature } from "./galleryRules";

/** What one card needs from a row; the page hands over nothing else. */
export type GallerySet = {
  id: string;
  status: string;
  error: string | null;
  input: SetInput;
  memberStates: MemberStates | null;
};

/** How often the page asks the server what changed while sets are still being drawn. */
const POLL_MS = 3000;

/**
 * How long the gallery keeps asking with nothing changing before it calls the batch stuck.
 *
 * A tick that died mid-set leaves its rows in `processing`, where no later tick will claim them:
 * the batch reports work forever and a plain "poll while busy" would hammer the database until the
 * tab is closed. Ten minutes is twice the route's 300 s life, so neither a tick that uses its whole
 * budget nor an export rendering the last of two hundred sets is ever mistaken for a dead one.
 */
const STUCK_MS = 10 * 60 * 1000;

type BoardProps = {
  batchId: string;
  name: string;
  batchStatus: string;
  /** The batch row's `updated_at`, epoch ms — how old the current `exporting` claim is. */
  updatedAt: number;
  zipUrl: string | null;
  batchError: string | null;
  sets: GallerySet[];
};

export default function Gallery(props: BoardProps) {
  return (
    <ToastHost>
      <Board {...props} />
    </ToastHost>
  );
}

function Board({ batchId, name, batchStatus, updatedAt, zipUrl, batchError, sets }: BoardProps) {
  const router = useRouter();
  const { show } = useToast();
  const { pending, run } = useAction();
  const [picked, setPicked] = useState<string[]>([]);

  const counts = useMemo(() => galleryCounts(sets), [sets]);
  // An export is a long render on a route, so the page waits for it the same way it waits for the
  // processing chain: by asking the server again until the batch carries a `zipUrl`.
  const exporting = batchStatus === "exporting";
  const busy = isBusy(counts) || exporting;
  const [stuck, setStuck] = useState(false);

  /**
   * The browser's clock, sampled while an export is running — and only there.
   *
   * `Date.now()` is never read during a render: the server's answer and the client's would differ
   * and React would call that a hydration mismatch. It starts at 0, which reads as "not sampled
   * yet" and keeps the first paint identical on both sides; the first sample lands immediately
   * after mount and then follows the poll's cadence, so an export that dies while the tab is open
   * grows its retry on its own rather than needing a reload.
   */
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!exporting) return;
    const sample = () => setNow(Date.now());
    const first = setTimeout(sample, 0);
    const timer = setInterval(sample, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [exporting]);
  /** Whether this export has been sitting in `exporting` long enough that no function still holds it. */
  const exportStale = now !== 0 && exportRetryable(batchStatus, updatedAt, now);

  // When the last render showed something different from the one before it, work is alive.
  const signature = useMemo(() => `${batchStatus}:${zipUrl ?? ""}:${batchError ?? ""}|${statusSignature(sets)}`, [batchStatus, zipUrl, batchError, sets]);
  // `at: 0` means "not stamped yet": the clock is read in the effect below, never during a render.
  const lastChange = useRef({ signature, at: 0 });
  useEffect(() => {
    if (lastChange.current.at !== 0 && lastChange.current.signature === signature) return;
    lastChange.current = { signature, at: Date.now() };
    setStuck(false);
  }, [signature]);

  /**
   * While anything is queued or being drawn, ask the server for a fresh render every few seconds.
   * The interval is torn down the moment nothing is moving — and the poll gives up altogether once
   * `STUCK_MS` has passed with no change at all, handing the batch to the "Lanjutkan" button rather
   * than asking a database the same question forever.
   */
  useEffect(() => {
    if (!busy || stuck) return;
    const timer = setInterval(() => {
      if (Date.now() - lastChange.current.at > STUCK_MS) setStuck(true);
      else router.refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [busy, stuck, router]);

  // A set that moved on — approved elsewhere, failed on a retry — must not stay ticked.
  const selected = useMemo(() => approvable(picked, sets), [picked, sets]);

  const approve = (ids: string[], key: string) =>
    run(key, async () => {
      const res = await approveSetsAction(ids);
      if (!res.ok) return res;
      setPicked([]);
      show(res.data.approved === 1 ? "1 set disetujui." : `${res.data.approved} set disetujui.`, "ok");
      router.refresh();
    });

  return (
    <div className="min-h-full">
      <StatusBar
        name={name}
        counts={counts}
        batchStatus={batchStatus}
        notice={batchError}
        stuck={stuck}
        resuming={pending === "resume"}
        onResume={() =>
          run("resume", async () => {
            const res = await resumeBatchAction(batchId);
            if (!res.ok) return res;
            const { remaining, requeued } = res.data;
            show(
              remaining === 0
                ? "Semua set sudah selesai."
                : requeued > 0
                  ? `${requeued} set dilanjutkan, ${remaining} set masih antre.`
                  : `Lanjut, ${remaining} set masih antre.`,
              "ok",
            );
            // A resume is a change by definition: give the poll its full window again.
            lastChange.current = { signature: "", at: Date.now() };
            setStuck(false);
            router.refresh();
          })
        }
      />

      <main className="mx-auto w-full max-w-6xl px-6 pb-16">
        <GalleryActions
          readyCount={counts.ready}
          approvedCount={counts.approved}
          selected={selected.length}
          pending={pending === "approve-selected"}
          exporting={exporting}
          exportStale={exportStale}
          zipUrl={zipUrl}
          onExport={() =>
            run("export", async () => {
              const res = await exportBatchAction(batchId);
              if (!res.ok) return res;
              show(res.data.started ? "Menyiapkan ZIP, tunggu sebentar." : "Ekspor sudah berjalan.", "ok");
              // A start is a change: give the poll its full window again so it does not call the
              // batch stuck while the export is still rendering.
              lastChange.current = { signature: "", at: Date.now() };
              setStuck(false);
              router.refresh();
            })
          }
          onSelectAll={() => setPicked(sets.filter(s => s.status === "ready").map(s => s.id))}
          onClear={() => setPicked([])}
          onApprove={() => approve(selected, "approve-selected")}
        />

        <div className="space-y-3 pt-3">
          {sets.map(row => (
            <SetCard
              key={row.id}
              row={row}
              pending={pending}
              selected={selected.includes(row.id)}
              onSelect={on => setPicked(prev => (on ? [...prev, row.id] : prev.filter(id => id !== row.id)))}
              onApprove={() => approve([row.id], `approve:${row.id}`)}
              onReject={() =>
                run(`reject:${row.id}`, async () => {
                  const res = await rejectSetAction(row.id);
                  if (!res.ok) return res;
                  show(`Set ${row.input.kidName} ditolak.`, "ok");
                  router.refresh();
                })
              }
              onRegenerate={note =>
                run(`regen:${row.id}`, async () => {
                  const res = await regenerateSetAction(row.id, note);
                  if (!res.ok) return res;
                  show(`Set ${row.input.kidName} digambar ulang.`, "ok");
                  router.refresh();
                })
              }
            />
          ))}
        </div>

        {sets.length === 0 && <p className="pt-8 text-[13px] text-muted">Batch ini belum punya set.</p>}
      </main>
    </div>
  );
}
