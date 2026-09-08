"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { SetInputSchema, SetStyleSchema, type SetInput, type SetStyle } from "@/engine";
import { createNodeMeasurer, loadImageFromFile } from "@/engine/server";
import { getProvider, generateClipart, describeClipart, chooseStyle } from "@/ai";
import { db, schema } from "@/db";
import { putBlob } from "@/lib/blob";
import { clipartSize, exportSetZip } from "@/lib/sets";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MESSAGE, processClipartUpload } from "@/lib/upload";

const { sets } = schema;

/** Logs the real cause (never secrets) and surfaces a short Indonesian message to the client. */
function fail(context: string, cause: unknown): never {
  console.error(`[sets] ${context}:`, cause instanceof Error ? cause.message : cause);
  throw new Error(context);
}

type LoadedSet = { input: SetInput; style: SetStyle | null };

async function loadSet(id: string): Promise<LoadedSet> {
  const row = await db.query.sets.findFirst({ where: eq(sets.id, id) });
  if (!row) throw new Error("Desain tidak ditemukan.");
  const input = SetInputSchema.safeParse(row.input);
  if (!input.success) fail("Data desain rusak, coba buat ulang.", input.error);
  const style = SetStyleSchema.nullable().safeParse(row.style ?? null);
  if (!style.success) fail("Data gaya rusak, buat ulang gayanya.", style.error);
  return { input: input.data, style: style.data };
}

async function write(id: string, patch: Partial<typeof sets.$inferInsert>) {
  await db.update(sets).set({ ...patch, updatedAt: new Date() }).where(eq(sets.id, id));
  revalidatePath(`/set/${id}`);
}

export async function createSet(input: SetInput): Promise<{ id: string }> {
  const parsed = SetInputSchema.safeParse(input);
  if (!parsed.success) fail("Data desain tidak valid.", parsed.error);
  try {
    const [row] = await db.insert(sets).values({ input: parsed.data, status: "draft" }).returning({ id: sets.id });
    revalidatePath("/");
    return { id: row.id };
  } catch (e) {
    fail("Gagal menyimpan desain.", e);
  }
}

export async function saveSet(id: string, patch: { input?: SetInput; style?: SetStyle }): Promise<void> {
  await loadSet(id); // 404s early and keeps the same error vocabulary
  const next: Partial<typeof sets.$inferInsert> = {};
  if (patch.input !== undefined) {
    const parsed = SetInputSchema.safeParse(patch.input);
    if (!parsed.success) fail("Data desain tidak valid.", parsed.error);
    next.input = parsed.data;
  }
  if (patch.style !== undefined) {
    const parsed = SetStyleSchema.safeParse(patch.style);
    if (!parsed.success) fail("Data gaya tidak valid.", parsed.error);
    next.style = parsed.data;
  }
  if (!Object.keys(next).length) return;
  try {
    await write(id, next);
  } catch (e) {
    fail("Gagal menyimpan perubahan.", e);
  }
}

/** Stores a new clipart on the set (and on the style, when one already exists). */
async function saveClipart(id: string, loaded: LoadedSet, url: string) {
  await write(id, {
    input: { ...loaded.input, clipartSrc: url },
    ...(loaded.style ? { style: { ...loaded.style, clipartSrc: url } } : {}),
  });
}

export async function generateClipartAction(id: string): Promise<{ url: string; width: number; height: number }> {
  const loaded = await loadSet(id);
  let result: { url: string; width: number; height: number };
  try {
    result = await generateClipart(loaded.input.theme, { provider: getProvider(), putBlob });
  } catch (e) {
    fail("Gagal membuat clipart, coba lagi.", e);
  }
  try {
    await saveClipart(id, loaded, result.url);
  } catch (e) {
    fail("Gagal menyimpan clipart.", e);
  }
  return result;
}

export async function uploadClipartAction(id: string, form: FormData): Promise<{ url: string; width: number; height: number }> {
  const loaded = await loadSet(id);
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("Pilih file gambar dulu.");
  if (file.size > MAX_UPLOAD_BYTES) throw new Error(MAX_UPLOAD_MESSAGE);
  let png: Buffer, width: number, height: number, url: string;
  try {
    ({ png, width, height } = await processClipartUpload(Buffer.from(await file.arrayBuffer())));
    url = await putBlob(`clipart/upload-${Date.now()}.png`, png, "image/png");
  } catch (e) {
    fail("Gagal memproses gambar, coba file lain.", e);
  }
  try {
    await saveClipart(id, loaded, url);
  } catch (e) {
    fail("Gagal menyimpan clipart.", e);
  }
  return { url, width, height };
}

export async function generateStyleAction(id: string, note?: string): Promise<{ style: SetStyle; aiFallback: boolean; rationale: string }> {
  const { input, style } = await loadSet(id);
  const src = input.clipartSrc ?? style?.clipartSrc;
  if (!src) throw new Error("Tambahkan clipart dulu (generate atau upload).");
  let result: { style: SetStyle; aiFallback: boolean; rationale: string };
  try {
    const provider = getProvider();
    const meta = await describeClipart(src, { provider });
    result = await chooseStyle(input, { url: src, meta }, { provider }, note);
  } catch (e) {
    fail("Gagal membuat gaya, coba lagi.", e);
  }
  try {
    await write(id, { style: result.style, aiFallback: result.aiFallback, error: null });
  } catch (e) {
    fail("Gagal menyimpan gaya.", e);
  }
  return result;
}

export async function exportSetAction(id: string): Promise<{ zipUrl: string; sizes: Record<string, { widthCm: number; heightCm: number }> }> {
  const { input, style } = await loadSet(id);
  if (!style) throw new Error("Buat gayanya dulu sebelum export.");
  let zipUrl: string, sizes: Record<string, { widthCm: number; heightCm: number }>;
  try {
    const size = await clipartSize(style.clipartSrc);
    const out = await exportSetZip({ input, style }, { measure: createNodeMeasurer(), clipartSize: size, loadImage: loadImageFromFile });
    sizes = out.sizes;
    zipUrl = await putBlob(`exports/${id}-${Date.now()}.zip`, out.zip, "application/zip");
  } catch (e) {
    fail("Gagal membuat file export, coba lagi.", e);
  }
  try {
    await write(id, { exportUrl: zipUrl, status: "ready" });
  } catch (e) {
    fail("Gagal menyimpan hasil export.", e);
  }
  return { zipUrl, sizes };
}
