"use client";

import { LAYER_LABEL } from "./labels";
import { Button, Section } from "@/app/components/ui";

/**
 * The way back from "Hapus".
 *
 * A hidden layer is gone from the design, so it cannot be clicked on the canvas and the inspector
 * has no way to reach it. Without this list the only route back is undo, which the next page load
 * throws away — the delete would be permanent by accident rather than by decision.
 *
 * `ids` comes from `expand`, so it names layers this member's template actually drew and hid,
 * never a stale override for a slot the wording no longer emits.
 */
export function HiddenLayers({ ids, onShow }: { ids: string[]; onShow: (layerId: string) => void }) {
  if (!ids.length) return null;
  return (
    <Section title="Dihapus">
      <ul className="space-y-1.5">
        {ids.map(id => (
          <li key={id} className="flex items-center justify-between gap-2">
            <span className="text-[13px] text-muted line-through">{LAYER_LABEL[id] ?? id}</span>
            <Button data-testid={`show-layer-${id}`} onClick={() => onShow(id)}>
              Kembalikan
            </Button>
          </li>
        ))}
      </ul>
    </Section>
  );
}
