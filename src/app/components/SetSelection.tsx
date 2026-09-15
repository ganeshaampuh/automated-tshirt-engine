"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { deleteSetsAction } from "@/app/actions/batches";
import { ConfirmButton, Button, useAction, useToast } from "@/app/components/ui";

/**
 * Ticking sets on the home page, one by one, to delete them together.
 *
 * The list around it stays server-rendered: this provider holds only the ticked ids, and each
 * checkbox is its own small island beside a row's link, never inside it. The selection is a moment's
 * work, not saved anywhere — a reload clears it, as it should for a destructive action.
 *
 * `ids` is every set the page currently shows. Picks are read through it, so a set that vanished on
 * a refresh (deleted in another tab, say) can never be carried into the next delete.
 */
type Api = { picked: string[]; toggle: (id: string, on: boolean) => void };

const Ctx = createContext<Api>({ picked: [], toggle: () => {} });

export function SetSelection({
  ids,
  underway,
  children,
}: {
  ids: string[];
  /** Sets still being drawn. They can be deleted, but the confirmation says it stops the drawing. */
  underway: string[];
  children: ReactNode;
}) {
  const router = useRouter();
  const { show } = useToast();
  const { pending, run } = useAction();
  const [raw, setRaw] = useState<string[]>([]);

  const picked = useMemo(() => raw.filter(id => ids.includes(id)), [raw, ids]);
  const api = useMemo<Api>(
    () => ({ picked, toggle: (id, on) => setRaw(prev => (on ? [...prev, id] : prev.filter(p => p !== id))) }),
    [picked],
  );

  const remove = () =>
    run("delete-picked", async () => {
      const res = await deleteSetsAction(picked);
      if (!res.ok) return res;
      const { deleted } = res.data;
      // The action only passes over a set that is already gone — another tab got there first.
      const gone = picked.length - deleted;
      setRaw([]);
      show(
        deleted === 0
          ? "Set yang dipilih sudah tidak ada. Muat ulang halaman."
          : gone > 0
            ? `${deleted} set dihapus, ${gone} sudah tidak ada.`
            : `${deleted} set dihapus.`,
        deleted === 0 ? "bad" : "ok",
      );
      router.refresh();
    });

  return (
    <Ctx.Provider value={api}>
      {children}
      {/* Pinned to the bottom of the screen only while something is ticked, so it is in reach
          wherever in a long list the last tick was made. */}
      {picked.length > 0 && (
        <div
          data-testid="set-selection-bar"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-rule bg-panel px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]"
        >
          <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-2">
            <p className="font-display text-[14px]">{picked.length} set dipilih</p>
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              <Button variant="quiet" disabled={pending !== null} onClick={() => setRaw([])}>
                Bersihkan pilihan
              </Button>
              <ConfirmButton
                testId="delete-picked-sets"
                variant="default"
                confirm={`${picked.some(id => underway.includes(id)) ? "Hentikan & hapus" : "Hapus"} ${picked.length} set?`}
                pending={pending === "delete-picked"}
                title="Hapus semua set yang dicentang untuk selamanya"
                onConfirm={remove}
              >
                Hapus terpilih
              </ConfirmButton>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

/** One set's tick. */
export function SetCheckbox({ id, name, className = "" }: { id: string; name: string; className?: string }) {
  const { picked, toggle } = useContext(Ctx);
  return (
    <input
      type="checkbox"
      data-testid="pick-set"
      className={`size-4 shrink-0 cursor-pointer accent-[var(--color-mat)] ${className}`}
      checked={picked.includes(id)}
      aria-label={`Pilih set ${name}`}
      onChange={e => toggle(id, e.target.checked)}
    />
  );
}
