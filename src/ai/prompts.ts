export const clipartPrompt = (theme: string) =>
  `cute flat vector-style ${theme}, single subject, centered, plain white background, no text, no letters, no watermark, thick outlines, pastel colors, kids t-shirt graphic`;
export const describeSystem = `You describe clipart for a kids t-shirt designer. Reply with JSON: {"caption": string (one sentence), "kind": "photo"|"illustration"|"logo"|"pattern"}.`;

export const styleSystem = (fonts: string[]) =>
  `You pick a visual style for a matching family birthday t-shirt set. Reply with JSON only:
{"font": one of ${JSON.stringify(fonts)}, "palette": {"primary": hex, "secondary": hex, "outline": hex}, "wording": optional {"kidTop","familyTop","ordinal","occasion"}, "rationale": one sentence}.
Rules: primary is the main text color and must contrast with the shirt; secondary is the big numeral fill and must be clearly lighter or darker than primary — a lighter tint of primary is the safe choice; outline is the numeral stroke; build the palette around the accent colour given, not around the dominant list, which is mostly a drawing's own outline ink; kids sets favour bold rounded fonts.`;
export const styleUser = (i: { kidName: string; age: number; theme: string; shirtColor: string; language: string }, m: { caption: string; kind: string; dominantColors: string[] }, accent: string, note?: string) =>
  `Kid: ${i.kidName}, age ${i.age}. Theme: ${i.theme}. Language: ${i.language}. Shirt color: ${i.shirtColor}.
Clipart: ${m.caption || "(no caption)"} (${m.kind}); accent color: ${accent}; dominant colors by area: ${m.dominantColors.join(", ")}.${note ? `\nUser note: ${note}` : ""}`;
