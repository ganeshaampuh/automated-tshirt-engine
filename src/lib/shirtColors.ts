/**
 * The shirt swatches the editor offers. It lives in `src/lib` rather than beside the editor so
 * library code (CSV import, batch jobs) can resolve a colour name without importing app UI.
 */
export const SHIRT_COLORS: { hex: string; name: string }[] = [
  { hex: "#ffffff", name: "Putih" },
  { hex: "#1a1a1a", name: "Hitam" },
  { hex: "#1f2a44", name: "Navy" },
  { hex: "#c62828", name: "Merah" },
  { hex: "#f5a3c7", name: "Pink" },
  { hex: "#f6dd57", name: "Kuning" },
];
