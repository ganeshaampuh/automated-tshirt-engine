"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Stage, Layer, Image as KImage, Text as KText, Transformer, Rect } from "react-konva";
import type Konva from "konva";
import type { Design, Layer as DLayer, TextLayer, ImageLayer } from "../../types";
import { displayText } from "../../text";
import { imageGeometry, imageTopLeft, textGeometry, textTopLeft } from "./geometry";
import { nearestWeight } from "../../fonts";

/** Fields a drag or resize can write back. `TextLayer & ImageLayer` collapses to `never` on `type`,
 *  so the two layer shapes are merged without their discriminant. */
export type LayerPatch = Partial<Omit<TextLayer, "id" | "type">> & Partial<Omit<ImageLayer, "id" | "type">>;

export type DesignStageProps = {
  design: Design;
  scale: number;
  /** Hex fill painted behind the layers, or `null` for a transparent stage (matches the server). */
  background?: string | null;
  editable?: boolean;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  /** Patches are in print px, exactly like the layer fields they replace. */
  onChange?: (layerId: string, patch: LayerPatch) => void;
  /** Fired once every image layer has loaded and the stage has drawn them. */
  onReady?: () => void;
};

let measureCtx: CanvasRenderingContext2D | null = null;
const offsetCache = new Map<string, number>();

/**
 * Vertical shift that makes a Konva `Text` land where the server's `textBaseline = "top"` puts it.
 *
 * Konva ignores `textBaseline` and anchors a line by font metrics: it draws on the alphabetic
 * baseline at `(ascent - descent) / 2 + fontSize / 2` below the node's top. The server draws at the
 * canvas `"top"` baseline, which is neither of those — for Fredoka both skia and Chrome put it
 * ~0.81 * fontSize above the alphabetic baseline, not at the 0.97 * fontSize font ascent. That
 * distance is read back per font/size by measuring the same glyph against both baselines, since
 * `TextMetrics` is reported relative to the context's current `textBaseline`.
 */
function topBaselineOffset(font: string, weight: number, size: number): number {
  const key = `${weight}|${size}|${font}`;
  const cached = offsetCache.get(key);
  if (cached !== undefined) return cached;
  if (typeof document === "undefined") return 0;
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  const ctx = measureCtx;
  if (!ctx) return 0;
  ctx.font = `${weight} ${size}px "${font}"`;
  ctx.textBaseline = "top";
  const fromTop = ctx.measureText("M");
  ctx.textBaseline = "alphabetic";
  const fromAlphabetic = ctx.measureText("M");
  // How far the alphabetic baseline sits below the "top" baseline.
  const topToAlphabetic = fromAlphabetic.actualBoundingBoxAscent - fromTop.actualBoundingBoxAscent;
  const ascent = fromAlphabetic.fontBoundingBoxAscent ?? size;
  const descent = fromAlphabetic.fontBoundingBoxDescent ?? 0;
  const off = topToAlphabetic - (ascent - descent) / 2 - size / 2;
  offsetCache.set(key, off);
  return off;
}

function geometry(l: DLayer) {
  return l.type === "image" ? imageGeometry(l) : textGeometry(l, topBaselineOffset(l.font, nearestWeight(l.font, l.weight), l.size));
}

function useHtmlImage(src: string, onLoad?: (src: string) => void) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    const i = new window.Image();
    i.crossOrigin = "anonymous";
    i.onload = () => {
      setImg(i);
      onLoad?.(src);
    };
    i.src = src;
    return () => {
      i.onload = null;
    };
  }, [src, onLoad]);
  return img;
}

type NodeProps<L> = {
  l: L;
  editable?: boolean;
  onChange?: DesignStageProps["onChange"];
  onSelect?: DesignStageProps["onSelect"];
  nodeRef: (n: Konva.Node | null) => void;
};

function ImageNode({ l, editable, onChange, onSelect, nodeRef, onLoad }: NodeProps<ImageLayer> & { onLoad: (src: string) => void }) {
  const img = useHtmlImage(l.src, onLoad);
  const g = geometry(l);
  if (!img) return null;
  return (
    <KImage
      ref={nodeRef} id={l.id} image={img} x={g.x} y={g.y} width={l.w} height={l.h}
      offsetX={g.offsetX} offsetY={g.offsetY} rotation={l.rotation ?? 0} draggable={editable}
      onClick={() => onSelect?.(l.id)} onTap={() => onSelect?.(l.id)}
      onDragEnd={e => onChange?.(l.id, imageTopLeft(e.target.position(), g, 1, 1))}
      onTransformEnd={e => {
        const n = e.target as Konva.Image;
        const sx = n.scaleX(), sy = n.scaleY();
        const w = n.width() * sx, h = n.height() * sy;
        const { x, y } = imageTopLeft(n.position(), g, sx, sy);
        n.scaleX(1); n.scaleY(1);
        onChange?.(l.id, { x, y, w, h, rotation: n.rotation() });
      }}
    />
  );
}

function TextNode({ l, editable, onChange, onSelect, nodeRef }: NodeProps<TextLayer>) {
  const g = geometry(l);
  // Konva builds its font string as `fontStyle fontVariant fontSize fontFamily`, so a numeric
  // weight travels in `fontStyle`. Resolve it to a shipped face first: the family may not have the
  // requested weight, and the measurers resolve it the same way.
  const weight = nearestWeight(l.font, l.weight);
  return (
    <KText
      ref={nodeRef} id={l.id} text={displayText(l)} x={g.x} y={g.y} width={l.maxWidth} align={l.align}
      offsetX={g.offsetX} offsetY={g.offsetY}
      fontFamily={l.font} fontStyle={String(weight)} fontSize={l.size} letterSpacing={l.letterSpacing ?? 0}
      fill={l.color} stroke={l.stroke?.color} strokeWidth={l.stroke ? l.stroke.width * 2 : 0}
      fillAfterStrokeEnabled lineJoin="round"
      shadowColor={l.shadow?.color} shadowBlur={l.shadow?.blur ?? 0}
      shadowOffsetX={l.shadow?.dx ?? 0} shadowOffsetY={l.shadow?.dy ?? 0} shadowEnabled={!!l.shadow}
      shadowForStrokeEnabled={!!l.shadow}
      rotation={l.rotation ?? 0} wrap="none" verticalAlign="top" draggable={editable}
      onClick={() => onSelect?.(l.id)} onTap={() => onSelect?.(l.id)}
      onDragEnd={e => onChange?.(l.id, textTopLeft(e.target.position(), g, 1))}
      onTransformEnd={e => {
        const n = e.target as Konva.Text;
        const sx = n.scaleX();
        const maxWidth = n.width() * sx;
        const { x, y } = textTopLeft(n.position(), g, sx);
        n.scaleX(1); n.scaleY(1);
        onChange?.(l.id, { x, y, maxWidth, rotation: n.rotation() });
      }}
    />
  );
}

export function DesignStage({ design, scale, background = null, editable, selectedId, onSelect, onChange, onReady }: DesignStageProps) {
  const nodes = useRef(new Map<string, Konva.Node>());
  const trRef = useRef<Konva.Transformer>(null);
  const layerRef = useRef<Konva.Layer>(null);

  // Readiness is tracked by source, not by layer: an edit that only moves a layer must not make a
  // ready stage un-ready, and a decoded image is reused across designs.
  const [loadedSrcs, setLoadedSrcs] = useState<ReadonlySet<string>>(() => new Set());
  const markLoaded = useCallback((src: string) => {
    setLoadedSrcs(prev => (prev.has(src) ? prev : new Set(prev).add(src)));
  }, []);
  const ready = design.layers.every(l => l.type !== "image" || loadedSrcs.has(l.src));
  const wasReady = useRef(false);
  useEffect(() => {
    if (ready === wasReady.current) return;
    wasReady.current = ready;
    if (!ready) return;
    // Draw synchronously so `onReady` cannot fire before the images are on the canvas.
    layerRef.current?.draw();
    onReady?.();
  }, [ready, onReady]);

  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const n = selectedId ? nodes.current.get(selectedId) : undefined;
    tr.nodes(n ? [n] : []);
    tr.getLayer()?.batchDraw();
  }, [selectedId, design]);

  const W = Math.round(design.canvas.w * scale), H = Math.round(design.canvas.h * scale);
  return (
    <Stage
      width={W} height={H} scaleX={scale} scaleY={scale}
      onMouseDown={e => { if (e.target === e.target.getStage()) onSelect?.(null); }}
    >
      <Layer ref={layerRef}>
        {background && <Rect x={0} y={0} width={design.canvas.w} height={design.canvas.h} fill={background} listening={false} />}
        {design.layers.map((l: DLayer) => {
          const ref = (n: Konva.Node | null) => {
            if (n) nodes.current.set(l.id, n);
            else nodes.current.delete(l.id);
          };
          return l.type === "image"
            ? <ImageNode key={l.id} l={l} editable={editable} onChange={onChange} onSelect={onSelect} nodeRef={ref} onLoad={markLoaded} />
            : <TextNode key={l.id} l={l} editable={editable} onChange={onChange} onSelect={onSelect} nodeRef={ref} />;
        })}
        {editable && (
          <Transformer
            ref={trRef} rotateEnabled keepRatio
            enabledAnchors={["top-left", "top-right", "bottom-left", "bottom-right"]}
          />
        )}
      </Layer>
    </Stage>
  );
}
