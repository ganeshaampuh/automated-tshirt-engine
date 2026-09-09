import { del, put } from "@vercel/blob";

export async function putBlob(
  path: string,
  body: Buffer | Blob,
  contentType: string
): Promise<string> {
  const { url } = await put(path, body, {
    access: "public",
    contentType,
    addRandomSuffix: true,
  });
  return url;
}

/**
 * Uploads a body that is still being produced.
 *
 * `put` accepts a `ReadableStream` (`PutBody` in `@vercel/blob`), so the batch export can hand it a
 * ZIP that is written set by set instead of a Buffer it would have to hold whole — two hundred
 * rendered sets do not fit in a function's memory. Kept separate from `putBlob` on purpose: every
 * existing caller passes bytes it already has, and widening that signature would invite a stream
 * into paths that read `body.length`.
 */
export async function putBlobStream(
  path: string,
  body: ReadableStream<Uint8Array>,
  contentType: string
): Promise<string> {
  const { url } = await put(path, body, {
    access: "public",
    contentType,
    addRandomSuffix: true,
  });
  return url;
}

/**
 * Best-effort cleanup for a blob whose row never landed. A failure here is logged and swallowed: the
 * caller is already on an error path, and an orphaned file is a smaller problem than masking why.
 */
export async function deleteBlob(url: string): Promise<void> {
  try {
    await del(url);
  } catch (e) {
    console.error("[blob] could not delete", url, e instanceof Error ? e.message : e);
  }
}
