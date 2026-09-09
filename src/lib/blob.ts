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
