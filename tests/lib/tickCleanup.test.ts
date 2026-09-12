import { describe, it, expect } from "vitest";
import { orphanBlobs } from "@/lib/tickCleanup";
import type { ProcessResult, ProcessRow } from "@/lib/processSet";
import type { SetStyle } from "@/engine";
import { unicornSet } from "../fixtures/set-unicorn";

const style = (clipartSrc: string): SetStyle => ({
  template: "collage",
  font: "Fredoka",
  palette: { primary: "#e6007e", secondary: "#f9a8d4", outline: "#222222" },
  clipartSrc,
  wording: { kidTop: "Rara", familyTop: "Keluarga Rara", ordinal: "ke-7", occasion: "Ulang Tahun" },
});

const row = (clipartSrc?: string): ProcessRow => {
  const { input } = unicornSet();
  const { clipartSrc: _dropped, ...rest } = input;
  return { id: "s1", input: { ...rest, ...(clipartSrc ? { clipartSrc } : {}) }, style: null, memberStates: {} };
};

const out = (over: Partial<ProcessResult> = {}): ProcessResult => ({
  style: style("https://blob.test/clipart/unicorn.png"),
  aiFallback: false,
  status: "ready",
  memberStates: {
    m1: { status: "ready", previewUrl: "https://blob.test/previews/s1-m1.jpg" },
    m2: { status: "ready", previewUrl: "https://blob.test/previews/s1-m2.jpg" },
  },
  ...over,
});

/**
 * What a cancelled tick has to take back out of Blob storage: the files it uploaded before it
 * noticed the row it was working for had been deleted. Nothing else — a file the shop supplied is
 * not the tick's to remove, and a delete aimed at one would be a request to a store that does not
 * hold it.
 */
describe("orphanBlobs", () => {
  it("collects every preview this tick uploaded", () => {
    expect(orphanBlobs(row("https://shop.example/own.png"), out({ style: style("https://shop.example/own.png") }))).toEqual([
      "https://blob.test/previews/s1-m1.jpg",
      "https://blob.test/previews/s1-m2.jpg",
    ]);
  });

  it("includes the clipart when the tick generated it for a row that had none", () => {
    expect(orphanBlobs(row(), out())).toContain("https://blob.test/clipart/unicorn.png");
  });

  it("leaves the shop's own clipart alone", () => {
    const own = "https://shop.example/own.png";
    expect(orphanBlobs(row(own), out({ style: style(own) }))).not.toContain(own);
  });

  it("has nothing to take back for a failed set that uploaded nothing", () => {
    expect(orphanBlobs(row(), out({ status: "failed", style: null, memberStates: { m1: { status: "failed", error: "x" } } }))).toEqual([]);
  });

  it("skips a member that never got as far as a preview", () => {
    expect(
      orphanBlobs(row("https://shop.example/own.png"), out({ style: style("https://shop.example/own.png"), memberStates: { m1: { status: "queued" } } })),
    ).toEqual([]);
  });
});
