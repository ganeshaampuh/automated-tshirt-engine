"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { exportSetAction, generateClipartAction, generateStyleAction, saveSet, uploadClipartAction } from "@/app/actions/sets";
import { CanvasPanel, type View } from "./components/CanvasPanel";
import { InputsPanel } from "./components/InputsPanel";
import { Inspector } from "./components/Inspector";
import { MemberTabs } from "./components/MemberTabs";
import { SizeReadout } from "./components/SizeReadout";
import { Button, ToastHost, useAction, useToast } from "./components/ui";
import { useSetEditor, type Initial, type LayerPatch, type Scope } from "./useSetEditor";

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

  const [view, setView] = useState<View>("shirt");
  const [scope, setScope] = useState<Scope>("set");
  const [zipUrl, setZipUrl] = useState<string | null>(null);
  const { pending, run } = useAction();

  const member = state.input.members.find(m => m.id === memberId);

  const onPatch = useCallback(
    (layerId: string, patch: LayerPatch) => dispatch({ type: "patchLayer", memberId, layerId, patch, scope }),
    [dispatch, memberId, scope],
  );

  const actions = useMemo(
    () => ({
      generateClipart: async () => {
        const { url } = await generateClipartAction(state.id);
        dispatch({ type: "setInput", patch: { clipartSrc: url } });
      },
      uploadClipart: async (file: File) => {
        const form = new FormData();
        form.set("file", file);
        const { url } = await uploadClipartAction(state.id, form);
        dispatch({ type: "setInput", patch: { clipartSrc: url } });
      },
      generateStyle: async (note?: string) => {
        const { style, aiFallback } = await generateStyleAction(state.id, note);
        dispatch({ type: "loaded", style });
        if (aiFallback) show("AI sedang tidak bisa dipakai, gaya cadangan dipakai.", "ok");
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
                const { zipUrl: url } = await exportSetAction(state.id);
                setZipUrl(url);
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
          />
        </aside>
      </div>
    </div>
  );
}
