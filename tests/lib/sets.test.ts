import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { unzipSync } from "fflate";
import { exportSetZip, guardRemoteImages, newByteCache } from "@/lib/sets";
import { fetchRemoteImage, RemoteImageError } from "@/lib/remoteImage";
import { createNodeMeasurer, loadImageFromFile } from "@/engine/server";
import type { Set } from "@/engine";
import { unicornSet, CLIPART_SIZE } from "../fixtures/set-unicorn";

// The remote door is stubbed so these tests never touch the network; `realFetchRemoteImage` puts the
// genuine guard back for the test that has to prove a blocked address is refused end to end.
vi.mock("@/lib/remoteImage", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/remoteImage")>();
  return { ...actual, fetchRemoteImage: vi.fn(actual.fetchRemoteImage) };
});
const mockedFetch = vi.mocked(fetchRemoteImage);
const realFetchRemoteImage = (await vi.importActual<typeof import("@/lib/remoteImage")>("@/lib/remoteImage")).fetchRemoteImage;
const unicornPng = readFileSync("tests/fixtures/unicorn.png");
const remoteSet = (): Set => {
  const s = unicornSet();
  return { ...s, style: { ...s.style, clipartSrc: "https://cdn.test/unicorn.png" } };
};

beforeEach(() => {
  mockedFetch.mockReset();
  mockedFetch.mockResolvedValue(unicornPng);
});

describe("guardRemoteImages", () => {
  it("fetches a remote src through the guard and hands the decoder bytes, once per src", async () => {
    const seen: string[] = [];
    const load = guardRemoteImages(async src => { seen.push(src); return {} as never; }, newByteCache());
    await load("https://cdn.test/unicorn.png");
    await load("https://cdn.test/unicorn.png");
    expect(mockedFetch).toHaveBeenCalledTimes(1);            // the cache spared the second fetch
    expect(mockedFetch).toHaveBeenCalledWith("https://cdn.test/unicorn.png");
    expect(seen).toHaveLength(2);
    for (const src of seen) expect(src.startsWith("data:")).toBe(true);   // never the URL itself
  });

  it("refuses a src that is neither remote, a data: image nor a shipped asset", async () => {
    const load = vi.fn(async () => ({}) as never);
    const guarded = guardRemoteImages(load);
    for (const src of ["/etc/passwd", "../../etc/passwd", "public/../../etc/passwd", "x", "", "file:///etc/passwd", "data:text/html,<script>"])
      await expect(guarded(src), src).rejects.toBeInstanceOf(RemoteImageError);
    expect(load).not.toHaveBeenCalled();
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("passes a shipped asset path and a data: image straight through", async () => {
    const load = vi.fn(async () => ({}) as never);
    const guarded = guardRemoteImages(load);
    await guarded("tests/fixtures/unicorn.png");
    await guarded("data:image/png;base64,AAAA");
    expect(load).toHaveBeenCalledTimes(2);
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});

describe("exportSetZip", () => {
  it("zips one print PNG and one mockup per member with cm sizes", async () => {
    const set = unicornSet();
    const { zip, sizes } = await exportSetZip(set, { measure: createNodeMeasurer(), clipartSize: CLIPART_SIZE, loadImage: loadImageFromFile });
    const files = unzipSync(new Uint8Array(zip));
    expect(Object.keys(files).sort()).toEqual(["Keisya-Ayah.mockup.jpg", "Keisya-Ayah.png", "Keisya-Keisya.mockup.jpg", "Keisya-Keisya.png", "Keisya-Kenzi.mockup.jpg", "Keisya-Kenzi.png", "Keisya-Mama.mockup.jpg", "Keisya-Mama.png"]);
    expect(sizes["ayah"].widthCm).toBeLessThanOrEqual(29);
    expect(sizes["kid"].widthCm).toBeLessThanOrEqual(20);
  }, 120_000);

  it("routes a remote clipart through the guard and fetches it once for the whole export", async () => {
    const { zip } = await exportSetZip(remoteSet(), { measure: createNodeMeasurer(), clipartSize: CLIPART_SIZE, loadImage: loadImageFromFile });
    expect(Object.keys(unzipSync(new Uint8Array(zip)))).toHaveLength(8);
    // eight renders of the same clipart, one fetch
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(mockedFetch).toHaveBeenCalledWith("https://cdn.test/unicorn.png");
  }, 120_000);

  it("refuses an export whose clipart resolves to a blocked address", async () => {
    mockedFetch.mockImplementation(realFetchRemoteImage);
    const set = unicornSet();
    const blocked = { ...set, style: { ...set.style, clipartSrc: "https://127.0.0.1/unicorn.png" } };
    // the renderer wraps a layer failure in its own Error, so the guard's refusal is asserted by
    // its (Indonesian, address-free) message travelling out with it
    await expect(exportSetZip(blocked, { measure: createNodeMeasurer(), clipartSize: CLIPART_SIZE, loadImage: loadImageFromFile }))
      .rejects.toThrow(/tidak diizinkan/i);
  }, 120_000);

  it("refuses a member override that points a layer at a readable image on the server", async () => {
    // The path has to be a *decodable* image that really exists: pre-fix, this file would have been
    // read and embedded in the ZIP the shop downloads, which is the whole exploit. Something like
    // /etc/passwd would make this test pass for the wrong reason — the decoder rejects an
    // undecodable file on its own, guard or no guard. Absolute, so the allowed-prefix list (which
    // contains the relative "tests/fixtures/") cannot be what saves us.
    const leak = path.resolve("tests/fixtures/unicorn.png");
    const load = vi.fn(loadImageFromFile);
    const set = unicornSet();
    set.input.members[1].overrides = { clipart: { src: leak } };
    // The schema stops it first, before a single layer is rendered.
    await expect(exportSetZip(set, { measure: createNodeMeasurer(), clipartSize: CLIPART_SIZE, loadImage: load })).rejects.toThrow();
    expect(load).not.toHaveBeenCalled();
    // And the last gate refuses the same path by type, for both spellings of it.
    const guarded = guardRemoteImages(load);
    await expect(guarded(leak)).rejects.toBeInstanceOf(RemoteImageError);
    await expect(guarded("public/../tests/fixtures/unicorn.png")).rejects.toBeInstanceOf(RemoteImageError);
    expect(load).not.toHaveBeenCalled();
  }, 120_000);
});
