"use client";

import { useEffect, useRef, useState } from "react";
import type { Language, SetInput } from "@/engine";
import type { ActionResult } from "@/lib/actionResult";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MESSAGE } from "@/lib/upload";
import type { Action } from "../useSetEditor";
import { SHIRT_COLORS } from "./labels";
import { MembersList } from "./MembersList";
import { Button, Field, Section, useAction, useToast } from "@/app/components/ui";

/** Each resolves to a failed `ActionResult` the caller should toast, or to nothing on success. */
type Ran = Promise<ActionResult<unknown> | void>;

export type InputsActions = {
  generateClipart: () => Ran;
  uploadClipart: (file: File) => Ran;
  generateStyle: (note?: string) => Ran;
};

export function InputsPanel({
  input,
  hasStyle,
  dispatch,
  actions,
}: {
  input: SetInput;
  hasStyle: boolean;
  dispatch: (a: Action) => void;
  actions: InputsActions;
}) {
  const { pending, run } = useAction();
  const { show } = useToast();
  const [note, setNote] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const name = useRef<HTMLInputElement>(null);

  // A new set opens on a placeholder name; select it so the first keystroke replaces it.
  useEffect(() => {
    name.current?.select();
  }, []);
  const set = (patch: Partial<SetInput>) => dispatch({ type: "setInput", patch });

  return (
    <div className="divide-y divide-rule">
      <Section title="Pesanan">
        <Field label="Nama anak">
          <input
            ref={name}
            className="field"
            data-testid="kid-name"
            autoFocus
            value={input.kidName}
            placeholder="Keisya"
            onChange={e => set({ kidName: e.target.value })}
          />
        </Field>
        <div className="flex gap-2">
          <div className="w-20">
            <Field label="Umur">
              <input
                className="field"
                type="number"
                min={0}
                max={120}
                value={input.age}
                onChange={e => set({ age: Math.max(0, Math.min(120, Number(e.target.value) || 0)) })}
              />
            </Field>
          </div>
          <div className="flex-1">
            <Field label="Bahasa">
              <select className="field" value={input.language} onChange={e => set({ language: e.target.value as Language })}>
                <option value="id">Indonesia</option>
                <option value="en">Inggris</option>
              </select>
            </Field>
          </div>
        </div>
        <Field label="Tema" hint="Dipakai untuk membuat clipart dan gaya.">
          <input className="field" value={input.theme} placeholder="unicorn pastel" onChange={e => set({ theme: e.target.value })} />
        </Field>
      </Section>

      <Section title="Warna kaos">
        <div className="flex flex-wrap items-center gap-1.5">
          {SHIRT_COLORS.map(c => (
            <button
              key={c.hex}
              title={c.name}
              aria-label={c.name}
              aria-pressed={input.shirtColor.toLowerCase() === c.hex}
              onClick={() => set({ shirtColor: c.hex })}
              style={{ background: c.hex }}
              className={`size-7 rounded-full border transition-[box-shadow] ${
                input.shirtColor.toLowerCase() === c.hex ? "border-ink shadow-[0_0_0_2px_var(--color-bench),0_0_0_3px_var(--color-ink)]" : "border-rule"
              }`}
            />
          ))}
          <input
            className="field ml-1 w-[84px] font-mono text-[12px] uppercase"
            value={input.shirtColor}
            aria-label="Kode warna"
            onChange={e => {
              const v = e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`;
              if (/^#[0-9a-fA-F]{6}$/.test(v)) set({ shirtColor: v.toLowerCase() });
            }}
          />
        </div>
      </Section>

      <Section title="Clipart">
        <div className="flex gap-3">
          <div className="checkerboard grid size-20 shrink-0 place-items-center overflow-hidden rounded-[var(--radius-ctl)] border border-rule">
            {input.clipartSrc ? (
              // eslint-disable-next-line @next/next/no-img-element -- clipart lives on blob storage, outside the image optimiser's configured hosts
              <img src={input.clipartSrc} alt="Clipart" className="size-full object-contain" />
            ) : (
              <span className="px-2 text-center text-[11px] text-muted">Belum ada</span>
            )}
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <Button
              pending={pending === "clipart"}
              disabled={!input.theme.trim()}
              onClick={() => run("clipart", actions.generateClipart)}
            >
              Buat dari tema
            </Button>
            <Button pending={pending === "upload"} onClick={() => file.current?.click()}>
              Upload gambar
            </Button>
            <input
              ref={file}
              data-testid="clipart-upload"
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                // Refused here rather than at the server: an oversized post is rejected by the
                // request body limit before the action runs, so it could never explain itself.
                if (f.size > MAX_UPLOAD_BYTES) {
                  show(MAX_UPLOAD_MESSAGE);
                  return;
                }
                run("upload", () => actions.uploadClipart(f));
              }}
            />
          </div>
        </div>
      </Section>

      <Section title="Daftar kaos">
        <MembersList members={input.members} dispatch={dispatch} />
      </Section>

      <Section title="Gaya">
        <Button
          variant={hasStyle ? "default" : "primary"}
          className="w-full"
          pending={pending === "style"}
          onClick={() => run("style", () => actions.generateStyle())}
        >
          {hasStyle ? "Buat ulang gaya (AI)" : "Buat gaya (AI)"}
        </Button>
        <Field label="Catatan untuk AI">
          <input
            className="field"
            value={note}
            placeholder="lebih kalem, jangan pink"
            onChange={e => setNote(e.target.value)}
          />
        </Field>
        <Button className="w-full" pending={pending === "note"} disabled={!note.trim()} onClick={() => run("note", () => actions.generateStyle(note))}>
          Terapkan catatan
        </Button>
      </Section>
    </div>
  );
}
