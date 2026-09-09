"use client";

import type { Member, SizeClass } from "@/engine";
import type { Action } from "../useSetEditor";
import { QUICK_MEMBERS, SIZE_CLASSES, SIZE_LABEL, newMemberId } from "./labels";
import { Button } from "@/app/components/ui";

export function MembersList({
  members,
  dispatch,
}: {
  members: Member[];
  dispatch: (a: Action) => void;
}) {
  const add = (label: string, sizeClass: SizeClass) =>
    dispatch({ type: "addMember", member: { id: newMemberId(), kind: "family", label, sizeClass } });

  return (
    <div className="space-y-2">
      {members.map(m => (
        <div key={m.id} className="flex items-center gap-1.5">
          <input
            className="field flex-1"
            value={m.label}
            aria-label={`Nama kaos ${m.label.trim() || "tanpa nama"}`}
            onChange={e => dispatch({ type: "updateMember", id: m.id, patch: { label: e.target.value } })}
          />
          <select
            className="field w-[104px] shrink-0"
            value={m.sizeClass}
            aria-label={`Ukuran kaos ${m.label.trim() || "tanpa nama"}`}
            onChange={e => dispatch({ type: "updateMember", id: m.id, patch: { sizeClass: e.target.value as SizeClass } })}
          >
            {SIZE_CLASSES.map(s => (
              <option key={s} value={s}>
                {SIZE_LABEL[s]}
              </option>
            ))}
          </select>
          {m.kind === "birthday-kid" ? (
            <span
              title="Kaos anak yang ulang tahun, tidak bisa dihapus"
              className="grid size-7 shrink-0 place-items-center rounded-[var(--radius-ctl)] bg-bench text-[13px]"
              aria-label="Anak ulang tahun"
            >
              ★
            </span>
          ) : (
            <Button
              variant="quiet"
              className="size-7 shrink-0 !px-0 text-[15px]"
              aria-label={`Hapus kaos ${m.label.trim() || "tanpa nama"}`}
              onClick={() => dispatch({ type: "removeMember", id: m.id })}
            >
              ×
            </Button>
          )}
        </div>
      ))}

      <div className="flex flex-wrap gap-1.5 pt-1">
        {QUICK_MEMBERS.map(q => (
          <Button key={q.label} onClick={() => add(q.label, q.sizeClass)}>
            + {q.label}
          </Button>
        ))}
        <Button onClick={() => add("Kaos baru", "adult")}>+ Lainnya</Button>
      </div>
    </div>
  );
}
