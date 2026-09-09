"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { waitUntil } from "@vercel/functions";
import { db, schema } from "@/db";
import { action, ActionError, type ActionResult } from "@/lib/actionResult";
import { putBlob } from "@/lib/blob";
import { rowsToInserts } from "@/lib/batchInserts";
import { parseBatchRows, type ParsedRow, type RowError } from "@/lib/csv";
import { MAX_UPLOAD_BYTES } from "@/lib/upload";

const { batches, sets } = schema;

/** Same ceiling as a clipart upload, worded for a spreadsheet: 8 MiB is far above any 200-row CSV. */
const MAX_CSV_MESSAGE = "Ukuran file CSV maksimal 8 MB.";

function fail(context: string, cause?: unknown): never {
  if (cause !== undefined) console.error(`[batches] ${context}:`, cause instanceof Error ? cause.message : cause);
  throw new ActionError(context);
}

type Upload = { name: string; text: string; bytes: Buffer };

/** The browser checks the size too, but a Server Action is a public POST and cannot trust it. */
async function readUpload(form: FormData): Promise<Upload> {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) fail("Pilih file CSV dulu.");
  if (file.size > MAX_UPLOAD_BYTES) fail(MAX_CSV_MESSAGE);
  const bytes = Buffer.from(await file.arrayBuffer());
  // A UTF-8 BOM is what Excel writes; left in place it would hide inside the first header name.
  const text = bytes.toString("utf8").replace(/^﻿/, "");
  return { name: file.name, text, bytes };
}

const countMembers = (rows: ParsedRow[]) => rows.reduce((n, r) => n + r.input.members.length, 0);

/** A dry run: it reads the file, reports what it found, and writes nothing anywhere. */
export async function validateCsvAction(
  form: FormData,
): Promise<ActionResult<{ rows: number; members: number; errors: RowError[] }>> {
  return action(async () => {
    const { text } = await readUpload(form);
    const { rows, errors } = parseBatchRows(text);
    return { rows: rows.length, members: countMembers(rows), errors };
  });
}

/**
 * The origin this request arrived on, so the tick route can be called by absolute URL.
 *
 * `x-forwarded-*` is what Vercel's proxy sets; `host` covers `next dev`. `VERCEL_URL` is the last
 * resort for a server-side call made without request headers.
 */
async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? process.env.VERCEL_URL;
  if (!host) return "";
  const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * Starts the processing chain without waiting for it.
 *
 * A failed kick is logged and swallowed on purpose: the batch is already durable, and the gallery's
 * "Lanjutkan" button starts a fresh chain. Creation must not fail because the tick did.
 */
function kickTick(origin: string, id: string) {
  if (origin === "") {
    console.error(`[batches] no origin for the tick of ${id}; it waits for a manual resume`);
    return;
  }
  waitUntil(
    fetch(`${origin}/api/batch/${id}/tick`, { method: "POST" }).then(
      res => {
        if (!res.ok) console.error(`[batches] tick for ${id} answered ${res.status}`);
      },
      e => console.error(`[batches] tick for ${id} failed:`, e instanceof Error ? e.message : e),
    ),
  );
}

/**
 * Creates a batch from a validated CSV. Refuses outright while any row is broken, so a shop never
 * ends up with a batch that is missing the rows it thought it uploaded.
 */
export async function createBatchFromCsvAction(form: FormData): Promise<ActionResult<{ id: string }>> {
  return action(async () => {
    const { name, text, bytes } = await readUpload(form);
    const { rows, errors } = parseBatchRows(text);
    if (errors.length > 0) {
      fail(`CSV masih punya ${errors.length} baris bermasalah. Perbaiki dulu, lalu unggah lagi.`);
    }
    if (rows.length === 0) fail("Tidak ada baris data di file CSV.");

    let csvUrl: string;
    try {
      csvUrl = await putBlob(`batches/${Date.now()}.csv`, bytes, "text/csv; charset=utf-8");
    } catch (e) {
      fail("Gagal menyimpan file CSV.", e);
    }

    // The id is minted here rather than by the database so both inserts can go in one batch: the
    // sets need the batch id, and neon-http has no interactive `db.transaction` to read it back in.
    const id = crypto.randomUUID();
    try {
      // `db.batch` sends both statements to Neon's transaction endpoint, so a failed set insert
      // rolls the batch row back with it and never leaves half a batch behind.
      await db.batch([
        db.insert(batches).values({
          id,
          name: name.trim() === "" ? `Batch ${new Date().toISOString()}` : name.trim(),
          status: "processing",
          setCount: rows.length,
          csvUrl,
        }),
        db.insert(sets).values(rowsToInserts(id, rows)),
      ]);
    } catch (e) {
      fail("Gagal membuat batch.", e);
    }

    kickTick(await requestOrigin(), id);
    revalidatePath("/");
    return { id };
  });
}
