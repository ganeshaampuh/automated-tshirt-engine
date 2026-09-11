import { describe, it, expect, vi } from "vitest";
import { createNodeMeasurer, loadImageFromFile } from "@/engine/server";
import type { BatchZipDeps } from "@/lib/batchZip";
import { liveDb } from "./live";

/**
 * The export route reaches Blob storage directly rather than through a `deps` seam, and a test
 * database has no store behind it. `putBlobStream` stands in for the upload — draining the stream is
 * what lets the ZIP close — and `deleteBlob` is spied so the cleanup can be asserted.
 */
const uploads: { url: string; onClose: (() => Promise<void>) | null } = { url: "https://blob.test/batches/test.zip", onClose: null };

vi.mock("@/lib/blob", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/blob")>();
  return {
    ...actual,
    deleteBlob: vi.fn(async () => {}),
    deleteBlobs: vi.fn(async () => {}),
    putBlobStream: vi.fn(async (_path: string, body: ReadableStream<Uint8Array>) => {
      const reader = body.getReader();
      for (;;) {
        const { done } = await reader.read();
        if (done) break;
      }
      // The ZIP is now in the store. Whatever the test staged to happen "meanwhile" happens here.
      if (uploads.onClose) await uploads.onClose();
      return uploads.url;
    }),
  };
});

const deps = (): BatchZipDeps => ({
  measure: createNodeMeasurer(),
  loadImage: loadImageFromFile,
  clipartSize: async () => ({ w: 96, h: 96 }),
});

describe.skipIf(!liveDb)("POST /api/batch/[id]/export", () => {
  /**
   * The cancel path: the shop deletes the batch while the ZIP is being written.
   *
   * The route cannot be killed from outside, so it has to notice for itself once the upload is
   * done. What must not survive is the ZIP: its batch row is gone, nothing will ever link to it,
   * and it would sit in the store forever.
   */
  it("cleans up the ZIP and writes no verdict when the batch is deleted mid-export", async () => {
    const { eq } = await import("drizzle-orm");
    const { db, schema } = await import("@/db");
    const { deleteBlob } = await import("@/lib/blob");
    const { POST } = await import("@/app/api/batch/[id]/export/route");

    const id = crypto.randomUUID();
    await db.insert(schema.batches).values({
      id,
      name: "export cancel test",
      status: "exporting",
      setCount: 0,
      csvUrl: "https://blob.test/none.csv",
    });
    uploads.onClose = async () => {
      await db.delete(schema.batches).where(eq(schema.batches.id, id));
    };

    try {
      const res = await POST(
        new Request(`http://localhost:3000/api/batch/${id}/export`, { method: "POST" }),
        { params: Promise.resolve({ id }) },
        deps(),
      );
      expect(await res.json()).toMatchObject({ cancelled: true });
      expect(deleteBlob).toHaveBeenCalledWith(uploads.url);
    } finally {
      uploads.onClose = null;
      await db.delete(schema.batches).where(eq(schema.batches.id, id));
    }
  }, 60_000);
});
