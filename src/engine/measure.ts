import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { registerFonts } from "./fonts.node";
import type { TextMeasurer } from "./textFit";

let fontsRegistered = false;
export function ensureNodeFonts() {
  if (fontsRegistered) return;
  registerFonts((file, family) => {
    const ok = GlobalFonts.registerFromPath(file, family);
    if (!ok) {
      throw new Error(
        `Failed to register font "${family}" from ${file} — the font file is missing or unreadable. ` +
        `On a serverless deploy this usually means the asset was not traced into the bundle; ` +
        `check outputFileTracingIncludes covers ./public/fonts/**/*.`,
      );
    }
  });
  fontsRegistered = true;
}

export function createNodeMeasurer(): TextMeasurer {
  ensureNodeFonts();
  const ctx = createCanvas(10, 10).getContext("2d");
  return {
    width(text, font, weight, size, letterSpacing = 0) {
      ctx.font = `${weight} ${size}px "${font}"`;
      const base = ctx.measureText(text).width;
      return base + Math.max(0, text.length - 1) * letterSpacing;
    },
  };
}
