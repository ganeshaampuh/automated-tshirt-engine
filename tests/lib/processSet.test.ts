import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import type { SetInput } from "@/engine";
import { createNodeMeasurer, loadImageFromFile } from "@/engine/server";
import type { AIProvider } from "@/ai";
import { parseBatchRows } from "@/lib/csv";
import { initialStates, type MemberStates } from "@/lib/memberState";
import { fetchRemoteImage, RemoteImageError } from "@/lib/remoteImage";
import { processSet, type ProcessDeps, type ProcessRow } from "@/lib/processSet";

// The remote door is stubbed so these tests never touch the network. Every other test here keeps
// the clipart in a `data:` URL, which `fetchBytes` reads without going out at all.
vi.mock("@/lib/remoteImage", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/remoteImage")>();
  return { ...actual, fetchRemoteImage: vi.fn(actual.fetchRemoteImage) };
});
const mockedFetch = vi.mocked(fetchRemoteImage);

const unicornPng = readFileSync("tests/fixtures/unicorn.png");
const unicornDataUrl = `data:image/png;base64,${unicornPng.toString("base64")}`;

const { rows } = parseBatchRows(readFileSync("tests/fixtures/batch-sample.csv", "utf8"));
/** "Bima, 1, dinosaurus" — three members, the smallest row in the fixture. */
const bima = () => structuredClone(rows[1].input);

const rowFor = (input: SetInput): ProcessRow => ({
  id: "11111111-1111-1111-1111-111111111111",
  input,
  style: null,
  memberStates: initialStates(input.members.map(m => m.id)),
});

const DESCRIBE = { caption: "dinosaurus lucu", kind: "illustration" as const };
const STYLE = {
  font: "Fredoka",
  palette: { primary: "#e6007e", secondary: "#f9a8d4", outline: "#222222" },
  rationale: "cocok untuk anak",
};

/**
 * A provider that never leaves the process. `describeClipart` sends images and `chooseStyle` does
 * not, which is enough to tell the two calls apart.
 */
function fakeProvider(over: Partial<AIProvider> = {}): AIProvider {
  return {
    chatJSON: vi.fn(async ({ images }: { images?: string[] }) => (images?.length ? DESCRIBE : STYLE)),
    generateImage: vi.fn(async () => unicornPng),
    ...over,
  } as unknown as AIProvider;
}

/**
 * `putBlob` hands a clipart back as a `data:` URL rather than an `https://` one so the rest of the
 * pipeline can read it back without a network fetch; a preview is only ever stored, never re-read.
 */
const fakePutBlob = vi.fn(async (path: string, body: Buffer | Blob, contentType: string) =>
  path.startsWith("clipart/") ? `data:${contentType};base64,${(body as Buffer).toString("base64")}` : `https://blob.test/${path}`,
);

const deps = (provider: AIProvider = fakeProvider()): ProcessDeps => ({
  provider,
  putBlob: fakePutBlob,
  measure: createNodeMeasurer(),
  loadImage: loadImageFromFile,
});

const statuses = (states: MemberStates) => Object.values(states).map(s => s.status);

beforeEach(() => {
  fakePutBlob.mockClear();
  mockedFetch.mockReset();
  mockedFetch.mockRejectedValue(new RemoteImageError("Alamat gambar itu tidak bisa dibaca."));
});

describe("processSet", () => {
  it("generates a clipart, picks a style and renders every member", async () => {
    const provider = fakeProvider();
    const out = await processSet(rowFor(bima()), deps(provider));

    expect(out.status).toBe("ready");
    expect(out.error).toBeUndefined();
    expect(out.aiFallback).toBe(false);
    expect(provider.generateImage).toHaveBeenCalledTimes(1);
    expect(out.style?.font).toBe("Fredoka");
    expect(out.style?.clipartSrc).toMatch(/^data:image\/png;base64,/);
    expect(statuses(out.memberStates)).toEqual(["ready", "ready", "ready"]);
    for (const state of Object.values(out.memberStates)) {
      expect(state.previewUrl).toMatch(/^https:\/\/blob\.test\/previews\//);
      expect(state.widthCm).toBeGreaterThan(0);
      expect(state.heightCm).toBeGreaterThan(0);
    }
  }, 60_000);

  it("uses the clipart the CSV supplied and never generates one", async () => {
    const provider = fakeProvider();
    const input = { ...bima(), clipartSrc: unicornDataUrl };
    const out = await processSet(rowFor(input), deps(provider));

    expect(provider.generateImage).not.toHaveBeenCalled();
    expect(out.style?.clipartSrc).toBe(unicornDataUrl);
    expect(out.status).toBe("ready");
  }, 60_000);

  it("fails the set with a reason, and no throw, when the clipart cannot be fetched", async () => {
    const input = { ...bima(), clipartSrc: "https://cdn.test/dino.png" };
    const out = await processSet(rowFor(input), deps());

    expect(out.status).toBe("failed");
    expect(out.error).toBe("Alamat gambar itu tidak bisa dibaca.");
    expect(statuses(out.memberStates)).toEqual(["failed", "failed", "failed"]);
    for (const state of Object.values(out.memberStates)) expect(state.error).toBe(out.error);
  }, 60_000);

  it("falls back to a default style when the LLM keeps failing, and still finishes the set", async () => {
    const provider = fakeProvider({
      chatJSON: vi.fn(async () => {
        throw new Error("Z.ai 500");
      }) as unknown as AIProvider["chatJSON"],
    });
    const input = { ...bima(), clipartSrc: unicornDataUrl };
    const out = await processSet(rowFor(input), deps(provider));

    expect(out.aiFallback).toBe(true);
    expect(out.status).toBe("ready");
    expect(out.style?.clipartSrc).toBe(unicornDataUrl);
    expect(statuses(out.memberStates)).toEqual(["ready", "ready", "ready"]);
  }, 60_000);

  it("marks only the member whose render failed, leaving the set ready", async () => {
    const input = bima();
    input.clipartSrc = unicornDataUrl;
    // An override the design schema refuses: a negative size. It breaks this member's design and
    // nobody else's — spec §11 says the set stays ready.
    input.members[1] = { ...input.members[1], overrides: { numeral: { size: -1 } } };
    const out = await processSet(rowFor(input), deps());

    expect(out.status).toBe("ready");
    expect(out.error).toBeUndefined();
    expect(out.memberStates["m-2"].status).toBe("failed");
    expect(out.memberStates["m-2"].error).toBeTruthy();
    expect(out.memberStates["m-1"].status).toBe("ready");
    expect(out.memberStates["m-3"].status).toBe("ready");
  }, 60_000);
});
