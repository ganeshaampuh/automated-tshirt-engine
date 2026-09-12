"use client";
import { useEffect, useState } from "react";
import type { TextMeasurer } from "../../textFit";
import { nearestWeight } from "../../fonts";
import { loadEngineFonts } from "./fontFaces";

export function createBrowserMeasurer(): TextMeasurer {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  return {
    width(text, font, weight, size, letterSpacing = 0) {
      // Same resolution as the node measurer, so both sides agree on which face is being measured.
      ctx.font = `${nearestWeight(font, weight)} ${size}px "${font}"`;
      return ctx.measureText(text).width + Math.max(0, text.length - 1) * letterSpacing;
    },
  };
}

/**
 * A measurer that is only handed out once the fonts it will be asked about are in the browser.
 *
 * Measuring against a fallback face produces widths the print renderer will not reproduce, so the
 * canvas must wait — but only for the faces `families` names. A design using one family waits on
 * one file, not on all nine.
 *
 * Two rules hold this together:
 *
 *   - the hook is keyed on the *content* of `families`, not its identity, so a caller may build the
 *     list inline on every render;
 *   - once a measurer exists it is never withdrawn. Picking a new font in the inspector loads that
 *     face while the previous measurer keeps working, and the swap happens when the file lands —
 *     otherwise the canvas would blank on every font change.
 */
export function useBrowserMeasurer(families: string[]): TextMeasurer | null {
  // `|` and not a space: a family name has spaces in it ("Baloo 2"), and this key is split again.
  const key = [...families].sort().join("|");
  const [loaded, setLoaded] = useState<{ key: string; measure: TextMeasurer } | null>(null);
  useEffect(() => {
    let alive = true;
    loadEngineFonts(key ? key.split("|") : []).then(() => {
      if (alive) setLoaded({ key, measure: createBrowserMeasurer() });
    });
    return () => {
      alive = false;
    };
  }, [key]);
  return loaded?.measure ?? null;
}
