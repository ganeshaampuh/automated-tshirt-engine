"use client";
import { useEffect, useRef, useState } from "react";
import { Stage, Layer, Image as KImage, Text as KText, Transformer, Rect } from "react-konva";
import type Konva from "konva";
import type { Design, Layer as DLayer, TextLayer, ImageLayer } from "../../types";
import { displayText } from "../../text";

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
};

/**
 * The weight the *print* renderer actually draws with. `@napi-rs/canvas` does not select an instance
 * of our variable fonts: `400`, `700` and `900` all measure and draw the file's default face
 * (verified by measuring the same string at each weight through `createNodeMeasurer`). Chrome does
 * apply the `wght` axis, so honouring `layer.weight` here would make the on-screen design bolder
 * than the shirt that gets printed. Until the server can select an instance, the browser draws the
 * same default face — the preview's job is to match the print, not to out-render it.
 */
const PRINTED_WEIGHT = 400;

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

/**
 * Every node is positioned by its box centre (`offsetX/offsetY` at the centre) so that Konva rotates
 * around the same point the server does, and so the print-px top-left is always
 * `position - offset * scale - topOffset`.
 */
function geometry(l: DLayer) {
  if (l.type === "image") {
    return { top: 0, offsetX: l.w / 2, offsetY: l.h / 2, x: l.x + l.w / 2, y: l.y + l.h / 2 };
  }
  const top = topBaselineOffset(l.font, PRINTED_WEIGHT, l.size);
  const boxH = l.size * (l.lines ?? 1);
  return { top, offsetX: l.maxWidth / 2, offsetY: boxH / 2 - top, x: l.x + l.maxWidth / 2, y: l.y + boxH / 2 };
}

function topLeft(n: Konva.Node, top: number, sx: number, sy: number) {
  return { x: n.x() - n.offsetX() * sx, y: n.y() - n.offsetY() * sy - top };
}

function useHtmlImage(src: string) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    const i = new window.Image();
    i.crossOrigin = "anonymous";
    i.onload = () => setImg(i);
    i.src = src;
    return () => {
      i.onload = null;
    };
  }, [src]);
  return img;
}

type NodeProps<L> = {
  l: L;
  editable?: boolean;
  onChange?: DesignStageProps["onChange"];
  onSelect?: DesignStageProps["onSelect"];
  nodeRef: (n: Konva.Node | null) => void;
};

function ImageNode({ l, editable, onChange, onSelect, nodeRef }: NodeProps<ImageLayer>) {
  const img = useHtmlImage(l.src);
  const g = geometry(l);
  if (!img) return null;
  return (
    <KImage
      ref={nodeRef} id={l.id} image={img} x={g.x} y={g.y} width={l.w} height={l.h}
      offsetX={g.offsetX} offsetY={g.offsetY} rotation={l.rotation ?? 0} draggable={editable}
      onClick={() => onSelect?.(l.id)} onTap={() => onSelect?.(l.id)}
      onDragEnd={e => onChange?.(l.id, topLeft(e.target, 0, 1, 1))}
      onTransformEnd={e => {
        const n = e.target as Konva.Image;
        const sx = n.scaleX(), sy = n.scaleY();
        const w = n.width() * sx, h = n.height() * sy;
        const { x, y } = topLeft(n, 0, sx, sy);
        n.scaleX(1); n.scaleY(1);
        onChange?.(l.id, { x, y, w, h, rotation: n.rotation() });
      }}
    />
  );
}

function TextNode({ l, editable, onChange, onSelect, nodeRef }: NodeProps<TextLayer>) {
  const g = geometry(l);
  return (
    <KText
      ref={nodeRef} id={l.id} text={displayText(l)} x={g.x} y={g.y} width={l.maxWidth} align={l.align}
      offsetX={g.offsetX} offsetY={g.offsetY}
      fontFamily={l.font} fontStyle={String(PRINTED_WEIGHT)} fontSize={l.size} letterSpacing={l.letterSpacing ?? 0}
      fill={l.color} stroke={l.stroke?.color} strokeWidth={l.stroke ? l.stroke.width * 2 : 0}
      fillAfterStrokeEnabled lineJoin="round"
      shadowColor={l.shadow?.color} shadowBlur={l.shadow?.blur ?? 0}
      shadowOffsetX={l.shadow?.dx ?? 0} shadowOffsetY={l.shadow?.dy ?? 0} shadowEnabled={!!l.shadow}
      shadowForStrokeEnabled={!!l.shadow}
      rotation={l.rotation ?? 0} wrap="none" verticalAlign="top" draggable={editable}
      onClick={() => onSelect?.(l.id)} onTap={() => onSelect?.(l.id)}
      onDragEnd={e => onChange?.(l.id, topLeft(e.target, g.top, 1, 1))}
      onTransformEnd={e => {
        const n = e.target as Konva.Text;
        const sx = n.scaleX(), sy = n.scaleY();
        const maxWidth = n.width() * sx;
        const { x, y } = topLeft(n, g.top, sx, sy);
        n.scaleX(1); n.scaleY(1);
        onChange?.(l.id, { x, y, maxWidth, rotation: n.rotation() });
      }}
    />
  );
}

export function DesignStage({ design, scale, background = null, editable, selectedId, onSelect, onChange }: DesignStageProps) {
  const nodes = useRef(new Map<string, Konva.Node>());
  const trRef = useRef<Konva.Transformer>(null);
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
      <Layer>
        {background && <Rect x={0} y={0} width={design.canvas.w} height={design.canvas.h} fill={background} listening={false} />}
        {design.layers.map((l: DLayer) => {
          const ref = (n: Konva.Node | null) => {
            if (n) nodes.current.set(l.id, n);
            else nodes.current.delete(l.id);
          };
          return l.type === "image"
            ? <ImageNode key={l.id} l={l} editable={editable} onChange={onChange} onSelect={onSelect} nodeRef={ref} />
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
