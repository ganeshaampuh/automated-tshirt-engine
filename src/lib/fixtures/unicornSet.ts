import type { Set } from "@/engine";
import { defaultWording } from "@/engine";

/** Browser twin of `tests/fixtures/set-unicorn.ts`: same set, clipart served from `public/`. */
export const unicornSet = (language: "en" | "id" = "en"): Set => ({
  input: {
    kidName: "Keisya", age: 5, theme: "unicorn", shirtColor: "#ffffff", language,
    members: [
      { id: "ayah", kind: "family", label: "Ayah", sizeClass: "adult" },
      { id: "kid", kind: "birthday-kid", label: "Keisya", sizeClass: "kids-1-9" },
      { id: "kenzi", kind: "family", label: "Kenzi", sizeClass: "kids-1-9" },
      { id: "mama", kind: "family", label: "Mama", sizeClass: "adult" },
    ],
  },
  style: {
    template: "collage", font: "Fredoka",
    palette: { primary: "#e6007e", secondary: "#f9a8d4", outline: "#e6007e" },
    clipartSrc: "/samples/unicorn.png",
    wording: defaultWording({ kidName: "Keisya", age: 5 }),
  },
});

export const CLIPART_SIZE = { w: 1000, h: 800 };
