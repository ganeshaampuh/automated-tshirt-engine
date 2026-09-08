import { describe, it, expect } from "vitest";
import { imageGeometry, imageTopLeft, textGeometry, textTopLeft } from "@/engine/render/browser/geometry";

const image = { x: 100, y: 200, w: 400, h: 300 };
const text = { x: 100, y: 200, size: 80, lines: 1, maxWidth: 600 };
const TOP = 12; // browser-measured baseline compensation

describe("browser stage geometry", () => {
  it("anchors an image node at its box centre", () => {
    expect(imageGeometry(image)).toEqual({ top: 0, offsetX: 200, offsetY: 150, x: 300, y: 350 });
  });

  it("anchors a text node at the centre of the box the server rotates around", () => {
    // The node's y is the box centre (unshifted), and the baseline compensation lives in offsetY,
    // so the drawn top lands at y + TOP: 240 - 28 = 212 = 200 + 12.
    expect(textGeometry(text, TOP)).toEqual({ top: TOP, offsetX: 300, offsetY: 28, x: 400, y: 240 });
  });

  it("counts every line in the text box height", () => {
    expect(textGeometry({ ...text, lines: 3 }, TOP).offsetY).toBe(80 * 3 / 2 - TOP);
  });

  it("round-trips an undragged node back to the layer's top-left", () => {
    const gi = imageGeometry(image);
    expect(imageTopLeft(gi, gi, 1, 1)).toEqual({ x: image.x, y: image.y });
    const gt = textGeometry(text, TOP);
    expect(textTopLeft(gt, gt, 1)).toEqual({ x: text.x, y: text.y });
  });

  it("reads a drag back as a plain translation", () => {
    const g = imageGeometry(image);
    expect(imageTopLeft({ x: g.x + 50, y: g.y - 25 }, g, 1, 1)).toEqual({ x: 150, y: 175 });
  });

  it("scales both offsets for an image resize, whose patch carries the new w and h", () => {
    const g = imageGeometry(image);
    // Konva keeps the node's position on the offset point, which is now 2 * offset from the corner.
    expect(imageTopLeft(g, g, 2, 2)).toEqual({ x: 300 - 400, y: 350 - 300 });
  });

  it("leaves the vertical term unscaled for a text resize, whose box height does not change", () => {
    const g = textGeometry(text, TOP);
    // Only maxWidth changes, so y must stay put no matter what Konva scaled the node by.
    expect(textTopLeft(g, g, 2)).toEqual({ x: 400 - 600, y: text.y });
    expect(textTopLeft(g, g, 0.5)).toEqual({ x: 400 - 150, y: text.y });
  });
});
