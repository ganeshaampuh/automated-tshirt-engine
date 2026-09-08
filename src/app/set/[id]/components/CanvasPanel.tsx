"use client";

import dynamic from "next/dynamic";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { maxCm, type Design } from "@/engine";
import type { LayerPatch, Scope } from "../useSetEditor";
import { Button } from "./ui";

// react-konva touches `window` at import time, so it must never run on the server.
const DesignStage = dynamic(() => import("@/engine/render/browser/DesignStage").then(m => m.DesignStage), { ssr: false });

export type View = "shirt" | "print";

type Shirt = { id: string; image: string; pxPerCm: number; chestAnchor: { x: number; y: number }; width: number; height: number };

const cache = new Map<string, Promise<Shirt>>();
const shirtId = (sizeClass: Design["sizeClass"]) => (sizeClass === "adult" ? "adult-flat" : "kids-flat");

function useShirt(sizeClass: Design["sizeClass"] | undefined) {
  const [shirt, setShirt] = useState<Shirt | null>(null);
  useEffect(() => {
    if (!sizeClass) return;
    const id = shirtId(sizeClass);
    if (!cache.has(id)) cache.set(id, fetch(`/mockups/${id}.json`).then(r => r.json()));
    let alive = true;
    cache.get(id)!.then(s => alive && setShirt(s));
    return () => {
      alive = false;
    };
  }, [sizeClass]);
  return shirt;
}

function useBox() {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, box] as const;
}

export function CanvasPanel({
  design,
  view,
  setView,
  scope,
  setScope,
  selected,
  onSelect,
  onPatch,
  footer,
}: {
  design: Design | null;
  view: View;
  setView: (v: View) => void;
  scope: Scope;
  setScope: (s: Scope) => void;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onPatch: (layerId: string, patch: LayerPatch) => void;
  footer: React.ReactNode;
}) {
  const shirt = useShirt(design?.sizeClass);
  const [ref, box] = useBox();

  let stage: React.ReactNode = null;
  if (design && box.w > 0) {
    if (view === "print") {
      const side = Math.min(box.w, box.h);
      stage = (
        <div className="checkerboard relative border border-rule" style={{ width: side, height: side }}>
          <div className="pointer-events-none absolute inset-[3%] border border-dashed border-alert/50" />
          <DesignStage design={design} scale={side / design.canvas.w} editable selectedId={selected} onSelect={onSelect} onChange={onPatch} />
        </div>
      );
    } else if (shirt) {
      const k = Math.min(box.w / shirt.width, box.h / shirt.height);
      const designW = shirt.pxPerCm * maxCm(design.sizeClass) * k;
      stage = (
        <div className="relative isolate" style={{ width: shirt.width * k, height: shirt.height * k }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- plain <img> keeps the mockup maths in raw pixels */}
          <img src={`/mockups/${shirt.image}`} alt="" className="absolute inset-0 size-full" />
          <div
            className="absolute inset-0 mix-blend-multiply"
            style={{
              background: design.shirtColor,
              maskImage: `url(/mockups/${shirt.image})`,
              maskSize: "100% 100%",
              WebkitMaskImage: `url(/mockups/${shirt.image})`,
              WebkitMaskSize: "100% 100%",
            }}
          />
          <div className="absolute" style={{ left: shirt.chestAnchor.x * k - designW / 2, top: shirt.chestAnchor.y * k }}>
            <DesignStage design={design} scale={designW / design.canvas.w} editable selectedId={selected} onSelect={onSelect} onChange={onPatch} />
          </div>
        </div>
      );
    }
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-4 border-b border-rule bg-panel px-4 py-2">
        <Toggle
          value={view}
          onChange={setView}
          options={[
            { value: "shirt" as const, label: "Di kaos" },
            { value: "print" as const, label: "Area cetak" },
          ]}
        />
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[12px] text-muted">Ubahan berlaku untuk</span>
          <Toggle
            value={scope}
            onChange={setScope}
            options={[
              { value: "set" as const, label: "Semua kaos" },
              { value: "member" as const, label: "Kaos ini" },
            ]}
          />
        </div>
      </div>

      <div ref={ref} className="mat flex min-h-[320px] flex-1 items-center justify-center overflow-hidden p-5" data-testid="canvas">
        {stage ?? <span className="max-w-[22ch] text-center text-[13px] text-white/60">Tambahkan clipart untuk melihat desainnya.</span>}
      </div>

      {footer}
    </div>
  );
}

function Toggle<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="flex gap-0.5 rounded-[var(--radius-ctl)] bg-bench p-0.5">
      {options.map(o => (
        <Button
          key={o.value}
          variant={value === o.value ? "default" : "quiet"}
          aria-pressed={value === o.value}
          className={value === o.value ? "border-rule" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </Button>
      ))}
    </div>
  );
}
