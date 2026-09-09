/**
 * Limits for a clipart upload, shared by the browser (which rejects early, before a doomed
 * round-trip) and the Server Action (which cannot trust the browser).
 *
 * `MAX_UPLOAD_BYTES` sits under the Server Action `bodySizeLimit` in `next.config.ts`, so an
 * accepted file always fits in the request; the slack covers FormData framing.
 */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export const MAX_UPLOAD_MESSAGE = "Ukuran gambar maksimal 8 MB. Kecilkan dulu, ya.";

/** The same ceiling worded for a batch CSV, which is a spreadsheet and not a picture. */
export const MAX_CSV_MESSAGE = "Ukuran file CSV maksimal 8 MB.";

/**
 * Decode guard against a decompression bomb: 100 MP is well past any phone camera (a 50 MP photo
 * is 8160x6120) while refusing an image that would need gigabytes of raw pixels.
 */
export const MAX_INPUT_PIXELS = 100_000_000;

/**
 * Longest edge kept in storage. The widest print canvas is 3425 px, so 4096 px still lets a clipart
 * fill it edge to edge with room to spare, and nothing downstream can ask for more.
 */
export const MAX_CLIPART_PX = 4096;
