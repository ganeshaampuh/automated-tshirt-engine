"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { approveSetsAction, regenerateSetAction, rejectSetAction, resumeBatchAction } from "@/app/actions/batches";
import { ToastHost, useAction, useToast } from "@/app/components/ui";
import type { SetInput } from "@/engine";
import type { MemberStates } from "@/lib/memberState";
import { GalleryActions } from "./components/GalleryActions";
import { SetCard } from "./components/SetCard";
import { StatusBar } from "./components/StatusBar";
import { approvable, galleryCounts, isBusy, statusSignature } from "./galleryRules";

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
 * tab is closed. Three minutes is several times the route's 60 s life, so a slow but living tick is
 * never mistaken for a dead one.
 */
const STUCK_MS = 3 * 60 * 1000;

export default function Gallery(props: { batchId: string; name: string; sets: GallerySet[] }) {
  return (
    <ToastHost>
      <Board {...props} />
    </ToastHost>
  );
}

function Board({ batchId, name, sets }: { batchId: string; name: string; sets: GallerySet[] }) {
  const router = useRouter();
  const { show } = useToast();
  const { pending, run } = useAction();
  const [picked, setPicked] = useState<string[]>([]);

  const counts = useMemo(() => galleryCounts(sets), [sets]);
  const busy = isBusy(counts);
  const [stuck, setStuck] = useState(false);

  // When the last render showed something different from the one before it, work is alive.
  const signature = useMemo(() => statusSignature(sets), [sets]);
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
          selected={selected.length}
          pending={pending === "approve-selected"}
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
