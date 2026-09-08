import { put } from "@vercel/blob";

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
