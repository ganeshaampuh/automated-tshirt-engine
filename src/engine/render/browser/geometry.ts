import type { ImageLayer, TextLayer } from "../../types";

/**
 * Where a Konva node for a layer goes, and how to read a layer's print-px top-left back off it.
 *
 * Every node is anchored by its box centre (`offset` sits at the centre, `x/y` is the centre) so
 * that Konva rotates around the point the server rotates around. `top` is the extra vertical shift a
 * text node needs because Konva anchors a line by font metrics rather than by the canvas `"top"`
 * baseline the server draws on; it is measured in the browser and passed in.
 */
export type NodeGeometry = {
  /** Baseline compensation already folded into `offsetY`; also the term the reversal subtracts. */
  top: number;
  offsetX: number;
  offsetY: number;
  x: number;
  y: number;
};

export function imageGeometry(l: Pick<ImageLayer, "x" | "y" | "w" | "h">): NodeGeometry {
  return { top: 0, offsetX: l.w / 2, offsetY: l.h / 2, x: l.x + l.w / 2, y: l.y + l.h / 2 };
}

export function textGeometry(l: Pick<TextLayer, "x" | "y" | "size" | "lines" | "maxWidth">, top: number): NodeGeometry {
  const boxH = l.size * (l.lines ?? 1);
  return { top, offsetX: l.maxWidth / 2, offsetY: boxH / 2 - top, x: l.x + l.maxWidth / 2, y: l.y + boxH / 2 };
}

/**
 * The layer's top-left, given the node's position after a drag or a transform.
 *
 * A transform leaves the node scaled, so the offset — which is in the node's own units — has to be
 * scaled with it. That is true of both axes for an image, whose patch carries the new `w`/`h`. A
 * text patch carries only `maxWidth`: `size` and `lines` are untouched, so the box is exactly as
 * tall as before and the vertical term must be reversed unscaled (`sy = 1`). Scaling it there would
 * move the committed `y` by `(sy - 1) * (boxH / 2 - top)` for no reason.
 */
export function imageTopLeft(position: { x: number; y: number }, g: NodeGeometry, sx: number, sy: number) {
  return topLeftFromCentre(position, g, sx, sy);
}

/** Text patches carry `maxWidth` only, so the vertical term is reversed unscaled. */
export function textTopLeft(position: { x: number; y: number }, g: NodeGeometry, sx: number) {
  return topLeftFromCentre(position, g, sx, 1);
}

function topLeftFromCentre(
  position: { x: number; y: number },
  g: Pick<NodeGeometry, "top" | "offsetX" | "offsetY">,
  sx: number,
  sy: number,
): { x: number; y: number } {
  return { x: position.x - g.offsetX * sx, y: position.y - g.offsetY * sy - g.top };
}
