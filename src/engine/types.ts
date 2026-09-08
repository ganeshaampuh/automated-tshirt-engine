import { z } from "zod";

export const SizeClassSchema = z.enum(["adult", "kids-0-1", "kids-1-9"]);
export type SizeClass = z.infer<typeof SizeClassSchema>;

export const LanguageSchema = z.enum(["id", "en"]);
export type Language = z.infer<typeof LanguageSchema>;

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const ImageLayerSchema = z.object({
  id: z.string(), type: z.literal("image"), src: z.string(),
  x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive(),
  rotation: z.number().optional(),
});
export type ImageLayer = z.infer<typeof ImageLayerSchema>;

export const TextLayerSchema = z.object({
  id: z.string(), type: z.literal("text"), text: z.string(),
  font: z.string(), weight: z.union([z.literal(400), z.literal(700), z.literal(900)]),
  size: z.number().positive(), color: Hex,
  stroke: z.object({ color: Hex, width: z.number().nonnegative() }).optional(),
  shadow: z.object({ color: Hex, blur: z.number(), dx: z.number(), dy: z.number() }).optional(),
  letterSpacing: z.number().optional(),
  transform: z.enum(["none", "upper"]).optional(),
  align: z.enum(["left", "center", "right"]),
  x: z.number(), y: z.number(), maxWidth: z.number().positive(),
  lines: z.number().int().positive().default(1),
  rotation: z.number().optional(),
});
export type TextLayer = z.infer<typeof TextLayerSchema>;

export const LayerSchema = z.discriminatedUnion("type", [ImageLayerSchema, TextLayerSchema]);
export type Layer = z.infer<typeof LayerSchema>;

export const CanvasSchema = z.object({ w: z.number().int().positive(), h: z.number().int().positive(), dpi: z.literal(300) });
export type Canvas = z.infer<typeof CanvasSchema>;

export const DesignSchema = z.object({
  version: z.literal(2), sizeClass: SizeClassSchema, canvas: CanvasSchema,
  shirtColor: Hex, layers: z.array(LayerSchema),
});
export type Design = z.infer<typeof DesignSchema>;

export const MemberSchema = z.object({
  id: z.string(), kind: z.enum(["birthday-kid", "family"]), label: z.string().min(1),
  sizeClass: SizeClassSchema,
  // keyed by layer id → partial layer fields (x, y, w, h, size, color, ...). Validated loosely here;
  // applyOverrides only spreads known keys onto an existing layer, and DesignSchema re-validates the result.
  overrides: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
});
export type Member = z.infer<typeof MemberSchema>;

export const SetInputSchema = z.object({
  kidName: z.string().min(1), age: z.number().int().min(0).max(120), theme: z.string().min(1),
  clipartSrc: z.string().optional(), shirtColor: Hex, language: LanguageSchema,
  members: z.array(MemberSchema).min(1),
}).refine(s => s.members.filter(m => m.kind === "birthday-kid").length === 1, { message: "exactly one birthday-kid member" });
export type SetInput = z.infer<typeof SetInputSchema>;

export const WordingSchema = z.object({
  kidTop: z.string(), familyTop: z.string(), ordinal: z.string(), occasion: z.string(),
});
export type Wording = z.infer<typeof WordingSchema>;

export const SetStyleSchema = z.object({
  template: z.literal("collage"), font: z.string(),
  palette: z.object({ primary: Hex, secondary: Hex, outline: Hex }),
  clipartSrc: z.string(), wording: WordingSchema,
});
export type SetStyle = z.infer<typeof SetStyleSchema>;

export const SetSchema = z.object({ input: SetInputSchema, style: SetStyleSchema });
export type Set = z.infer<typeof SetSchema>;
