"use client";
import { useEffect, useState } from "react";
import type { TextMeasurer } from "../../textFit";
import { loadEngineFonts } from "./fontFaces";

export function createBrowserMeasurer(): TextMeasurer {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  return {
    width(text, font, weight, size, letterSpacing = 0) {
      ctx.font = `${weight} ${size}px "${font}"`;
      return ctx.measureText(text).width + Math.max(0, text.length - 1) * letterSpacing;
    },
  };
}

export function useBrowserMeasurer(): TextMeasurer | null {
  const [m, setM] = useState<TextMeasurer | null>(null);
  useEffect(() => {
    let alive = true;
    loadEngineFonts().then(() => {
      if (alive) setM(createBrowserMeasurer());
    });
    return () => {
      alive = false;
    };
  }, []);
  return m;
}
