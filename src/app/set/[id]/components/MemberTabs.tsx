"use client";

import type { Member } from "@/engine";
import { SIZE_LABEL } from "./labels";

export function MemberTabs({
  members,
  memberId,
  unsafeIds,
  onSelect,
}: {
  members: Member[];
  memberId: string;
  unsafeIds: readonly string[];
  onSelect: (id: string) => void;
}) {
  return (
    <div role="tablist" aria-label="Kaos dalam set" className="flex gap-1 overflow-x-auto border-b border-rule bg-bench px-3 pt-2">
      {members.map(m => {
        const active = m.id === memberId;
        const unsafe = unsafeIds.includes(m.id);
        return (
          <button
            key={m.id}
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(m.id)}
            className={`-mb-px shrink-0 rounded-t-[var(--radius-ctl)] border border-b-0 px-3 py-1.5 text-left transition-colors ${
              active ? "border-rule bg-panel" : "border-transparent hover:bg-panel/60"
            }`}
          >
            <span className="flex items-center gap-1.5 font-display text-[13px] leading-tight">
              {m.label || "Tanpa nama"}
              {unsafe && (
                <span className="text-alert" title="Desain ini keluar dari area aman" aria-label="keluar dari area aman">
                  ▲
                </span>
              )}
            </span>
            <span className={`block text-[11px] leading-tight ${active ? "text-muted" : "text-muted/70"}`}>{SIZE_LABEL[m.sizeClass]}</span>
          </button>
        );
      })}
    </div>
  );
}
