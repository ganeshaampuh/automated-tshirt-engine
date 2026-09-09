"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { exportSetAction, generateClipartAction, generateStyleAction, saveSet, uploadClipartAction } from "@/app/actions/sets";
import { CanvasPanel, type View } from "./components/CanvasPanel";
import { InputsPanel } from "./components/InputsPanel";
import { Inspector } from "./components/Inspector";
import { MemberTabs } from "./components/MemberTabs";
import { SizeReadout } from "./components/SizeReadout";
import { Button, ToastHost, useAction, useToast } from "@/app/components/ui";
import { useSetEditor, type Initial, type LayerPatch, type Move, type Scope } from "./useSetEditor";

export default function SetEditor({ initial }: { initial: Initial }) {
  return (
    <ToastHost>
      <Editor initial={initial} />
    </ToastHost>
  );
}

const STATUS: Record<string, string> = {
  saved: "Tersimpan",
  saving: "Menyimpan…",
  pending: "Menyimpan…",
  invalid: "Lengkapi nama dan tema dulu",
  error: "Gagal menyimpan",
};

function Editor({ initial }: { initial: Initial }) {
  const { show } = useToast();
  const editor = useSetEditor(initial, { save: saveSet, onError: show });
  const { state, dispatch, designs, design, unsafeIds, warning, error, selected, setSelected, memberId, setMemberId, status } = editor;
  const { undo, redo, canUndo, canRedo } = editor;

  useUndoRedoKeys(undo, redo);

  const [view, setView] = useState<View>("shirt");
  const [scope, setScope] = useState<Scope>("set");
  const [zipUrl, setZipUrl] = useState<string | null>(null);
  const { pending, run } = useAction();

  const member = state.input.members.find(m => m.id === memberId);

  const onPatch = useCallback(
    (layerId: string, patch: LayerPatch) => dispatch({ type: "patchLayer", memberId, layerId, patch, scope }),
    [dispatch, memberId, scope],
  );

  const onReorder = useCallback(
    (layerId: string, move: Move) => {
      if (!design) return;
      // The rendered stack is the source of truth: a member with no stored order reorders from the
      // template's, and one that has an order reorders from that.
      dispatch({ type: "reorderLayer", memberId, layerId, move, ids: design.layers.map(l => l.id), scope });
    },
    [dispatch, design, memberId, scope],
  );

  useReorderKeys(selected, onReorder);

  const actions = useMemo(
    () => ({
      // Each returns the failed result untouched; `useAction` toasts its message.
      generateClipart: async () => {
        const res = await generateClipartAction(state.id);
        if (!res.ok) return res;
        dispatch({ type: "setInput", patch: { clipartSrc: res.data.url } });
      },
      uploadClipart: async (file: File) => {
        const form = new FormData();
        form.set("file", file);
        const res = await uploadClipartAction(state.id, form);
        if (!res.ok) return res;
        dispatch({ type: "setInput", patch: { clipartSrc: res.data.url } });
      },
      generateStyle: async (note?: string) => {
        const res = await generateStyleAction(state.id, note);
        if (!res.ok) return res;
        dispatch({ type: "loaded", style: res.data.style });
        if (res.data.aiFallback) show("AI sedang tidak bisa dipakai, gaya cadangan dipakai.", "ok");
      },
    }),
    [state.id, dispatch, show],
  );

  return (
    <div className="flex min-h-full flex-col lg:h-[100dvh] lg:overflow-hidden">
      <header className="flex items-center gap-3 border-b border-rule bg-panel px-4 py-2">
        <Link href="/" className="font-display text-[15px] font-medium">
          Kaos Ulang Tahun
        </Link>
        <span className="text-rule">/</span>
        <span className="truncate font-display text-[15px]">{state.input.kidName || "Set baru"}</span>
        <span className={`text-[12px] ${status === "error" || status === "invalid" ? "text-alert" : "text-muted"}`} data-testid="save-status">
          {STATUS[status]}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-0.5">
            <Button variant="quiet" data-testid="undo" disabled={!canUndo} onClick={undo} title="Batalkan (⌘Z)" aria-label="Batalkan">
              ↩
            </Button>
            <Button variant="quiet" data-testid="redo" disabled={!canRedo} onClick={redo} title="Ulangi (⇧⌘Z)" aria-label="Ulangi">
              ↪
            </Button>
          </div>
          {warning && (
            <button
              data-testid="safe-area-warning"
              className="text-[12px] font-medium text-alert underline underline-offset-2"
              onClick={() => setMemberId(unsafeIds[0])}
            >
              {warning}
            </button>
          )}
          {zipUrl && (
            <a href={zipUrl} data-testid="export-link" className="font-display text-[13px] underline underline-offset-2">
              Unduh ZIP
            </a>
          )}
          <Button
            variant="primary"
            data-testid="export"
            pending={pending === "export"}
            disabled={Boolean(warning) || !designs}
            title={warning ? "Rapikan layer yang keluar dari area aman dulu" : undefined}
            onClick={() =>
              run("export", async () => {
                const res = await exportSetAction(state.id);
                if (!res.ok) return res;
                setZipUrl(res.data.zipUrl);
                show("Export selesai.", "ok");
              })
            }
          >
            Export
          </Button>
        </div>
      </header>

      {error && <p className="bg-alert px-4 py-1.5 text-[13px] text-white">{error}</p>}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="w-full shrink-0 overflow-y-auto border-b border-rule bg-panel lg:w-[280px] lg:border-b-0 lg:border-r">
          <InputsPanel input={state.input} hasStyle={Boolean(state.style)} dispatch={dispatch} actions={actions} />
        </aside>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <MemberTabs members={state.input.members} memberId={memberId} unsafeIds={unsafeIds} onSelect={setMemberId} />
          <CanvasPanel
            design={design}
            view={view}
            setView={setView}
            scope={scope}
            setScope={setScope}
            selected={selected}
            onSelect={setSelected}
            onPatch={onPatch}
            footer={<SizeReadout design={design} />}
          />
        </main>

        <aside className="w-full shrink-0 overflow-y-auto border-t border-rule bg-panel lg:w-[280px] lg:border-t-0 lg:border-l">
          <Inspector
            design={design}
            member={member}
            selected={selected}
            onPatch={onPatch}
            onReset={layerId => dispatch({ type: "resetOverride", memberId, layerId })}
            onReorder={onReorder}
          />
        </aside>
      </div>
    </div>
  );
}

/**
 * ⌘Z / ⇧⌘Z (and Ctrl+Z / Ctrl+Y) anywhere on the page, text fields included: the inputs are
 * controlled by the reducer, so the browser's own field-level undo cannot work there anyway, and one
 * history for the whole editor is what a design tool is expected to have.
 */
function useUndoRedoKeys(undo: () => void, redo: () => void) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "z") {
        e.preventDefault();
        (e.shiftKey ? redo : undo)();
      } else if (key === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);
}

/** ⌘] / ⌘[ nudge the selected layer up and down the stack, the pair every design tool uses. */
function useReorderKeys(selected: string | null, onReorder: (layerId: string, move: Move) => void) {
  useEffect(() => {
    if (!selected) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const move = e.key === "]" ? "forward" : e.key === "[" ? "backward" : null;
      if (!move) return;
      e.preventDefault();
      onReorder(selected, move);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected, onReorder]);
}
