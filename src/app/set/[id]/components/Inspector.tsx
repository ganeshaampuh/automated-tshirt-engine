"use client";

import { CURATED_FONTS, fontWeights, nearestWeight, type Design, type Layer, type Member } from "@/engine";
import type { LayerPatch } from "../useSetEditor";
import { LAYER_LABEL, WEIGHT_LABEL } from "./labels";
import { Button, Field, Section } from "./ui";

function Num({ label, value, step = 1, onChange }: { label: string; value: number; step?: number; onChange: (n: number) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-muted">{label}</span>
      <input
        className="field font-mono tabular-nums"
        type="number"
        step={step}
        value={Math.round(value * 10) / 10}
        onChange={e => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
      />
    </label>
  );
}

function Color({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-muted">{label}</span>
      <div className="flex items-center gap-1.5">
        <input type="color" value={value} onChange={e => onChange(e.target.value)} className="size-8 shrink-0 cursor-pointer rounded-[var(--radius-ctl)] border border-rule bg-panel p-0.5" aria-label={label} />
        <input
          className="field font-mono text-[12px] uppercase"
          value={value}
          onChange={e => {
            const v = e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`;
            if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(v.toLowerCase());
          }}
        />
      </div>
    </label>
  );
}

export function Inspector({
  design,
  member,
  selected,
  onPatch,
  onReset,
}: {
  design: Design | null;
  member: Member | undefined;
  selected: string | null;
  onPatch: (layerId: string, patch: LayerPatch) => void;
  onReset: (layerId: string) => void;
}) {
  const layer: Layer | undefined = design?.layers.find(l => l.id === selected);
  if (!layer) {
    return (
      <Section title="Layer">
        <p className="text-[13px] leading-relaxed text-muted">Klik salah satu bagian desain untuk mengubah huruf, warna, atau posisinya.</p>
      </Section>
    );
  }
  const set = (patch: LayerPatch) => onPatch(layer.id, patch);
  const weights = layer.type === "text" ? fontWeights(layer.font) : [];
  const overridden = Boolean(member?.overrides?.[layer.id]);

  return (
    <Section
      title={LAYER_LABEL[layer.id] ?? layer.id}
      action={
        overridden ? (
          <Button variant="quiet" onClick={() => onReset(layer.id)}>
            Reset
          </Button>
        ) : null
      }
    >
      {layer.type === "image" ? (
        <div className="grid grid-cols-2 gap-2">
          <Num label="Kiri (px)" value={layer.x} onChange={x => set({ x })} />
          <Num label="Atas (px)" value={layer.y} onChange={y => set({ y })} />
          <Num label="Lebar (px)" value={layer.w} onChange={w => w > 0 && set({ w })} />
          <Num label="Tinggi (px)" value={layer.h} onChange={h => h > 0 && set({ h })} />
        </div>
      ) : (
        <>
          <Field label="Teks" hint="Ikut nama anak dan bahasa di panel kiri.">
            <input className="field bg-bench text-muted" value={layer.text} readOnly />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <label className="col-span-2 block">
              <span className="mb-1 block text-[11px] text-muted">Jenis huruf</span>
              <select
                className="field"
                aria-label="Jenis huruf"
                value={layer.font}
                onChange={e => {
                  const font = e.target.value;
                  // A family only ships some weights; keep the layer on a face that exists.
                  set({ font, weight: nearestWeight(font, layer.weight) });
                }}
                style={{ fontFamily: layer.font }}
              >
                {CURATED_FONTS.map(f => (
                  <option key={f} value={f} style={{ fontFamily: f }}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-muted">Tebal</span>
              <select
                className="field disabled:opacity-45"
                aria-label="Tebal"
                value={layer.weight}
                disabled={weights.length < 2}
                onChange={e => set({ weight: Number(e.target.value) as 400 | 700 | 900 })}
              >
                {weights.map(w => (
                  <option key={w} value={w}>
                    {WEIGHT_LABEL[w]}
                  </option>
                ))}
              </select>
              {weights.length < 2 && (
                <span className="mt-1 block text-[11px] text-muted">{layer.font} hanya punya satu ketebalan.</span>
              )}
            </label>
            <Num label="Ukuran (px)" value={layer.size} onChange={size => size > 0 && set({ size })} />
            <label className="block">
              <span className="mb-1 block text-[11px] text-muted">Rata</span>
              <select className="field" value={layer.align} onChange={e => set({ align: e.target.value as "left" | "center" | "right" })}>
                <option value="left">Kiri</option>
                <option value="center">Tengah</option>
                <option value="right">Kanan</option>
              </select>
            </label>
            <Num label="Kiri (px)" value={layer.x} onChange={x => set({ x })} />
            <Num label="Atas (px)" value={layer.y} onChange={y => set({ y })} />
            <div className="col-span-2">
              <Color label="Warna" value={layer.color} onChange={color => set({ color })} />
            </div>
            <div className="col-span-2">
              <Color
                label="Garis tepi"
                value={layer.stroke?.color ?? "#000000"}
                onChange={color => set({ stroke: { color, width: layer.stroke?.width ?? 0 } })}
              />
            </div>
            <div className="col-span-2">
              <Num
                label="Tebal garis tepi (px)"
                value={layer.stroke?.width ?? 0}
                onChange={width => set({ stroke: { color: layer.stroke?.color ?? "#000000", width: Math.max(0, width) } })}
              />
            </div>
            <label className="col-span-2 flex items-center gap-2 pt-1 text-[13px]">
              <input
                type="checkbox"
                checked={Boolean(layer.shadow)}
                onChange={e => set({ shadow: e.target.checked ? { color: "#000000", blur: 12, dx: 6, dy: 6 } : undefined })}
              />
              Bayangan
            </label>
            {layer.shadow && (
              <>
                <div className="col-span-2">
                  <Color label="Warna bayangan" value={layer.shadow.color} onChange={color => set({ shadow: { ...layer.shadow!, color } })} />
                </div>
                <Num label="Blur" value={layer.shadow.blur} onChange={blur => set({ shadow: { ...layer.shadow!, blur } })} />
                <Num label="Geser X" value={layer.shadow.dx} onChange={dx => set({ shadow: { ...layer.shadow!, dx } })} />
                <Num label="Geser Y" value={layer.shadow.dy} onChange={dy => set({ shadow: { ...layer.shadow!, dy } })} />
              </>
            )}
          </div>
        </>
      )}
    </Section>
  );
}
