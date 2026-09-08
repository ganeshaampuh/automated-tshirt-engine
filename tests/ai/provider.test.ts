import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { ZaiProvider, AIError } from "@/ai/provider";
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
