import { z } from "zod";

export const SizeClassSchema = z.enum(["adult", "kids-0-1", "kids-1-9"]);
export type SizeClass = z.infer<typeof SizeClassSchema>;

export const LanguageSchema = z.enum(["id", "en"]);
export type Language = z.infer<typeof LanguageSchema>;

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/**
 * Every image source this app is willing to read, whether it arrived as a `clipartSrc` or inside a
 * member override: an `https:` URL (which `fetchRemoteImage` then vets before a byte is fetched), an
 * inline `data:` image, or one of the asset paths this app ships — the test fixtures, `public/`, and
 * the public routes the browser and the dev parity page use. Anything else — `http:`, `file:`, an
 * absolute path, anything with `..` in it — is refused here rather than being handed to `readFile`
 * or `fetch` later. A member override can set a layer's `src`, so this must guard `ImageLayer` too,
 * not only the clipart field.
 */
const ASSET_PREFIXES = ["tests/fixtures/", "public/", "/samples/", "/mockups/", "/fonts/"];
export const isAllowedImageSrc = (s: string): boolean =>
  /^https:\/\//.test(s) ||
  s.startsWith("data:image/") ||
  // `..` is refused outright: an allowed prefix must not become a ladder out of the repo.
  (!s.includes("..") && ASSET_PREFIXES.some(p => s.startsWith(p)));

const ClipartSrc = z.string().refine(isAllowedImageSrc, {
  message: "image src must be an https URL, a data: image, or a bundled asset path",
});

/**
 * A layer the shop has taken out of this member's design.
 *
 * Deleting cannot mean removing the layer: `collage` rebuilds the stack from the wording every time
 * it runs, so a removed layer would simply come back. It is an override like any other, which is
 * what makes it undoable, restorable, and storable in the document already being saved.
 */
const Hidden = z.boolean().optional();

export const ImageLayerSchema = z.object({
  id: z.string(), type: z.literal("image"), src: ClipartSrc,
  x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive(),
  rotation: z.number().optional(), hidden: Hidden,
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
  rotation: z.number().optional(), hidden: Hidden,
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
  // The stacking this member's design is drawn in: layer ids back to front, the direction the
  // renderers walk `design.layers`. Absent — as it is on every set saved before layering existed —
  // means the template's own order. `applyOrder` decides what a stale list means.
  order: z.array(z.string()).optional(),
});
export type Member = z.infer<typeof MemberSchema>;

export const SetInputSchema = z.object({
  kidName: z.string().min(1), age: z.number().int().min(0).max(120), theme: z.string().min(1),
  clipartSrc: ClipartSrc.optional(), shirtColor: Hex, language: LanguageSchema,
  // What the shop calls this set — an order label like "Pesanan Bu Rina", not anything the renderer
  // reads. Optional because every set saved before naming existed has none, and because a shop that
  // never names a set should keep seeing the child's name; `setTitle` decides what a row shows.
  name: z.string().min(1).max(80).optional(),
  // The shop's own order code for this set. It names the set's folder in the batch export (spec
  // §8.2), so it is capped short enough to stay a sane directory name.
  skuPrefix: z.string().min(1).max(40).optional(),
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
  clipartSrc: ClipartSrc, wording: WordingSchema,
});
export type SetStyle = z.infer<typeof SetStyleSchema>;

export const SetSchema = z.object({ input: SetInputSchema, style: SetStyleSchema });
export type Set = z.infer<typeof SetSchema>;
