import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { ZaiProvider, AIError, providerOrDown, setProviderForTests } from "@/ai/provider";
import { MODELS, ZAI_BASE_URL } from "@/ai/config";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("ZaiProvider.chatJSON", () => {
  it("posts to chat/completions with json mode and parses the schema", async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe(`${ZAI_BASE_URL}/chat/completions`);
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe(MODELS.text);
      expect(body.response_format).toEqual({ type: "json_object" });
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k");
      return ok({ choices: [{ message: { content: '{"font":"Fredoka"}' } }] });
    });
    const p = new ZaiProvider({ apiKey: "k", fetch: fetchMock as unknown as typeof fetch });
    const out = await p.chatJSON({ system: "s", user: "u", schema: z.object({ font: z.string() }) });
    expect(out).toEqual({ font: "Fredoka" });
  });

  it("uses the vision model when images are given", async () => {
    const fetchMock = vi.fn(async (_u: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe(MODELS.vision);
      expect(body.messages[1].content[0]).toEqual({ type: "image_url", image_url: { url: "https://x/y.png" } });
      return ok({ choices: [{ message: { content: '{"kind":"illustration"}' } }] });
    });
    const p = new ZaiProvider({ apiKey: "k", fetch: fetchMock as unknown as typeof fetch });
    await p.chatJSON({ system: "s", user: "u", images: ["https://x/y.png"], schema: z.object({ kind: z.string() }) });
  });

  it("turns the model's reasoning off — it is what made a style take a minute", async () => {
    const fetchMock = vi.fn(async (_u: string, init: RequestInit) => {
      expect(JSON.parse(init.body as string).thinking).toEqual({ type: "disabled" });
      return ok({ choices: [{ message: { content: "{}" } }] });
    });
    const p = new ZaiProvider({ apiKey: "k", fetch: fetchMock as unknown as typeof fetch });
    await p.chatJSON({ system: "s", user: "u", schema: z.object({}) });
    await p.chatJSON({ system: "s", user: "u", images: ["https://x/y.png"], schema: z.object({}) });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("strips ```json fences and throws AIError with raw text on schema failure", async () => {
    const fetchMock = vi.fn(async () => ok({ choices: [{ message: { content: "```json\n{\"font\":42}\n```" } }] }));
    const p = new ZaiProvider({ apiKey: "k", fetch: fetchMock as unknown as typeof fetch });
    await expect(p.chatJSON({ system: "s", user: "u", schema: z.object({ font: z.string() }) })).rejects.toBeInstanceOf(AIError);
  });

  it("throws AIError on non-2xx", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 429 }));
    const p = new ZaiProvider({ apiKey: "k", fetch: fetchMock as unknown as typeof fetch });
    await expect(p.chatJSON({ system: "s", user: "u", schema: z.object({}) })).rejects.toThrow(/429/);
  });
});

describe("ZaiProvider.generateImage", () => {
  it("posts to images/generations and downloads the returned url", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/images/generations")) return ok({ data: [{ url: "https://cdn/x.png" }] });
      if (url === "https://cdn/x.png") return new Response(png, { status: 200 });
      throw new Error("unexpected " + url);
    });
    const p = new ZaiProvider({ apiKey: "k", fetch: fetchMock as unknown as typeof fetch });
    const out = await p.generateImage({ prompt: "unicorn" });
    expect(Buffer.compare(out, png)).toBe(0);
  });
});

/**
 * The seam that lets a missing key degrade instead of throwing.
 *
 * `getProvider` throws when `ZAI_API_KEY` is absent, and a caller that builds its provider inside a
 * try/catch turns that into an outright failure — which is what `generateStyleAction` did, so the
 * editor answered "Gagal membuat gaya" where it should have answered with the fallback style. A
 * provider that fails per *call* lets every swallow-and-degrade path downstream do its job.
 */
describe("providerOrDown", () => {
  const withoutKey = async (fn: () => Promise<void> | void) => {
    const had = process.env.ZAI_API_KEY;
    delete process.env.ZAI_API_KEY;
    setProviderForTests(undefined);
    try { await fn(); } finally { if (had !== undefined) process.env.ZAI_API_KEY = had; setProviderForTests(undefined); }
  };

  it("does not throw when there is no key", async () => {
    await withoutKey(() => { expect(() => providerOrDown()).not.toThrow(); });
  });

  it("gives back a provider whose every call fails with the reason", async () => {
    await withoutKey(async () => {
      const p = providerOrDown();
      await expect(p.generateImage({ prompt: "x" })).rejects.toThrow(/ZAI_API_KEY/);
      await expect(p.chatJSON({ system: "", user: "", schema: z.unknown() })).rejects.toThrow(/ZAI_API_KEY/);
    });
  });

  it("gives back the real provider when there is a key", async () => {
    const stub = { chatJSON: vi.fn(), generateImage: vi.fn() };
    setProviderForTests(stub);
    try { expect(providerOrDown()).toBe(stub); } finally { setProviderForTests(undefined); }
  });
});
