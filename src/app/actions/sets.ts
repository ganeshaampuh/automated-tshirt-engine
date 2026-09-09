"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { SetInputSchema, SetStyleSchema, type SetInput, type SetStyle } from "@/engine";
import { createNodeMeasurer, loadImageFromFile } from "@/engine/server";
import { getProvider, generateClipart, describeClipart, chooseStyle } from "@/ai";
import { db, schema } from "@/db";
import { clipartPatch } from "@/db/clipart";
import { action, ActionError, type ActionResult } from "@/lib/actionResult";
import { putBlob } from "@/lib/blob";
import { clipartSize, exportSetZip, newByteCache } from "@/lib/sets";
import { RemoteImageError } from "@/lib/remoteImage";
import { processClipartUpload } from "@/lib/clipartUpload";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MESSAGE } from "@/lib/upload";
import { initialStates, setMemberState, type MemberStates } from "@/lib/memberState";

const { sets } = schema;

/**
 * Logs the real cause (never secrets) and hands the client a short Indonesian message. The throw is
 * caught by `action` and returned as `{ ok: false }`: a message thrown out of a Server Action is
 * replaced by React with a generic English sentence in production.
 */
function fail(context: string, cause?: unknown): never {
  if (cause !== undefined) console.error(`[sets] ${context}:`, cause instanceof Error ? cause.message : cause);
  // A refused image URL is the shop's own mistake to fix, so its (already Indonesian, already
  // address-free) message is shown instead of the generic one.
  if (cause instanceof RemoteImageError) throw new ActionError(cause.message);
  throw new ActionError(context);
}

type LoadedSet = { input: SetInput; style: SetStyle | null };

async function loadSet(id: string): Promise<LoadedSet> {
  const row = await db.query.sets.findFirst({ where: eq(sets.id, id) });
  if (!row) fail("Desain tidak ditemukan.");
  const input = SetInputSchema.safeParse(row.input);
  if (!input.success) fail("Data desain rusak, coba buat ulang.", input.error);
  const style = SetStyleSchema.nullable().safeParse(row.style ?? null);
  if (!style.success) fail("Data gaya rusak, buat ulang gayanya.", style.error);
  return { input: input.data, style: style.data };
}

async function write(id: string, patch: PgUpdateSetSource<typeof sets>) {
  await db.update(sets).set({ ...patch, updatedAt: new Date() }).where(eq(sets.id, id));
  revalidatePath(`/set/${id}`);
}

export async function createSet(input: SetInput): Promise<ActionResult<{ id: string }>> {
  return action(async () => {
    const parsed = SetInputSchema.safeParse(input);
    if (!parsed.success) fail("Data desain tidak valid.", parsed.error);
    try {
      const [row] = await db.insert(sets).values({ input: parsed.data, status: "draft" }).returning({ id: sets.id });
      revalidatePath("/");
      return { id: row.id };
    } catch (e) {
      fail("Gagal menyimpan desain.", e);
    }
  });
}

export async function saveSet(id: string, patch: { input?: SetInput; style?: SetStyle }): Promise<ActionResult<void>> {
  return action(async () => {
    await loadSet(id); // 404s early and keeps the same error vocabulary
    const next: PgUpdateSetSource<typeof sets> = {};
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
  });
}

/**
 * Stores a new clipart on the set and, when one exists, on its style.
 *
 * Only the `clipartSrc` key is written — see `clipartPatch`. A clipart action can spend ten seconds
 * in image generation, and the edit the shop made while it ran must survive it.
 */
async function saveClipart(id: string, url: string) {
  await write(id, clipartPatch(url));
}

export async function generateClipartAction(id: string): Promise<ActionResult<{ url: string; width: number; height: number }>> {
  return action(async () => {
    const loaded = await loadSet(id);
    let result: { url: string; width: number; height: number };
    try {
      result = await generateClipart(loaded.input.theme, { provider: getProvider(), putBlob });
    } catch (e) {
      fail("Gagal membuat clipart, coba lagi.", e);
    }
    try {
      await saveClipart(id, result.url);
    } catch (e) {
      fail("Gagal menyimpan clipart.", e);
    }
    return result;
  });
}

export async function uploadClipartAction(
  id: string,
  form: FormData,
): Promise<ActionResult<{ url: string; width: number; height: number }>> {
  return action(async () => {
    await loadSet(id); // 404s early and keeps the same error vocabulary
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) fail("Pilih file gambar dulu.");
    if (file.size > MAX_UPLOAD_BYTES) fail(MAX_UPLOAD_MESSAGE);
    let png: Buffer, width: number, height: number, url: string;
    try {
      ({ png, width, height } = await processClipartUpload(Buffer.from(await file.arrayBuffer())));
      url = await putBlob(`clipart/upload-${Date.now()}.png`, png, "image/png");
    } catch (e) {
      fail("Gagal memproses gambar, coba file lain.", e);
    }
    try {
      await saveClipart(id, url);
    } catch (e) {
      fail("Gagal menyimpan clipart.", e);
    }
    return { url, width, height };
  });
}

export async function generateStyleAction(
  id: string,
  note?: string,
): Promise<ActionResult<{ style: SetStyle; aiFallback: boolean; rationale: string }>> {
  return action(async () => {
    const { input, style } = await loadSet(id);
    const src = input.clipartSrc ?? style?.clipartSrc;
    if (!src) fail("Tambahkan clipart dulu (generate atau upload).");
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
  });
}

/** Builds `memberStates` for a freshly exported set: every member is `ready` with its cm figures. */
function readyMemberStates(memberIds: string[], sizes: Record<string, { widthCm: number; heightCm: number }>): MemberStates {
  let states = initialStates(memberIds);
  for (const [memberId, size] of Object.entries(sizes)) {
    states = setMemberState(states, memberId, { status: "ready", widthCm: size.widthCm, heightCm: size.heightCm });
  }
  return states;
}

export async function exportSetAction(
  id: string,
): Promise<ActionResult<{ zipUrl: string; sizes: Record<string, { widthCm: number; heightCm: number }> }>> {
  return action(async () => {
    const { input, style } = await loadSet(id);
    if (!style) fail("Buat gayanya dulu sebelum export.");
    let zipUrl: string, sizes: Record<string, { widthCm: number; heightCm: number }>;
    try {
      // One cache for the whole export: the clipart is wanted once for its size and then twice per
      // member, and a remote src must not be fetched nine times.
      const cache = newByteCache();
      const size = await clipartSize(style.clipartSrc, cache);
      const out = await exportSetZip({ input, style }, { measure: createNodeMeasurer(), clipartSize: size, loadImage: loadImageFromFile, cache });
      sizes = out.sizes;
      zipUrl = await putBlob(`exports/${id}-${Date.now()}.zip`, out.zip, "application/zip");
    } catch (e) {
      fail("Gagal membuat file export, coba lagi.", e);
    }
    // `status` is deliberately untouched: `exportUrl` is the record that an export happened, and a
    // re-export must not demote a set someone has already approved.
    try {
      await write(id, { exportUrl: zipUrl, memberStates: readyMemberStates(input.members.map(m => m.id), sizes) });
    } catch (e) {
      fail("Gagal menyimpan hasil export.", e);
    }
    return { zipUrl, sizes };
  });
}
