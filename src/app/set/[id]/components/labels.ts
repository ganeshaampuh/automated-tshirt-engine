import type { FontWeight, SizeClass } from "@/engine";

export const SIZE_LABEL: Record<SizeClass, string> = {
  adult: "Dewasa",
  "kids-1-9": "Anak 1–9",
  "kids-0-1": "Bayi 0–1",
};

export const SIZE_CLASSES: SizeClass[] = ["adult", "kids-1-9", "kids-0-1"];

export const SHIRT_COLORS: { hex: string; name: string }[] = [
  { hex: "#ffffff", name: "Putih" },
  { hex: "#1a1a1a", name: "Hitam" },
  { hex: "#1f2a44", name: "Navy" },
  { hex: "#c62828", name: "Merah" },
  { hex: "#f5a3c7", name: "Pink" },
  { hex: "#f6dd57", name: "Kuning" },
];

/** Quick-add rows: the family a birthday set almost always needs. */
export const QUICK_MEMBERS: { label: string; sizeClass: SizeClass }[] = [
  { label: "Ayah", sizeClass: "adult" },
  { label: "Mama", sizeClass: "adult" },
  { label: "Kakak", sizeClass: "kids-1-9" },
  { label: "Adik", sizeClass: "kids-1-9" },
];

/** One entry per weight the font registry can ship; the Inspector's weight select reads it. */
export const WEIGHT_LABEL: Record<FontWeight, string> = {
  400: "Normal",
  700: "Tebal",
  900: "Sangat tebal",
};

export const LAYER_LABEL: Record<string, string> = {
  numeral: "Angka umur",
  clipart: "Clipart",
  top: "Baris atas",
  ordinal: "Awalan umur",
  occasion: "Kata acara",
  bottom: "Nama di bawah",
};

export const newMemberId = () =>
  `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
