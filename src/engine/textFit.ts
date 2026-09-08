export interface TextMeasurer {
  width(text: string, font: string, weight: number, size: number, letterSpacing?: number): number;
}

export type FitOpts = {
  text: string; font: string; weight: number;
  maxWidth: number; startSize: number; minSize: number; letterSpacing?: number;
};

/** Binary-search the largest integer size in [minSize, startSize] whose width fits. */
export function fitText(m: TextMeasurer, o: FitOpts): { size: number; width: number } {
  const ls = (size: number) => (o.letterSpacing ?? 0) * (size / o.startSize);
  const w = (size: number) => m.width(o.text, o.font, o.weight, size, ls(size));
  // Misconfigured caller: an empty [minSize, startSize] range. Never return above startSize.
  if (o.minSize > o.startSize) return { size: o.startSize, width: w(o.startSize) };
  if (w(o.startSize) <= o.maxWidth) return { size: o.startSize, width: w(o.startSize) };
  let lo = Math.ceil(o.minSize), hi = Math.floor(o.startSize);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (w(mid) <= o.maxWidth) lo = mid; else hi = mid - 1;
  }
  return { size: lo, width: w(lo) };
}
