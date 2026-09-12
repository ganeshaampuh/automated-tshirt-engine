import type { ZodType } from "zod";
import { MODELS, ZAI_BASE_URL } from "./config";

export class AIError extends Error { constructor(message: string, public readonly raw?: string) { super(message); } }

export interface AIProvider {
  chatJSON<T>(opts: { system: string; user: string; schema: ZodType<T>; images?: string[] }): Promise<T>;
  generateImage(opts: { prompt: string; size?: string }): Promise<Buffer>;
}

const stripFences = (s: string) => s.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();

export class ZaiProvider implements AIProvider {
  private readonly fetchFn: typeof fetch;
  constructor(private readonly opts: { apiKey: string; fetch?: typeof fetch }) { this.fetchFn = opts.fetch ?? fetch; }

  private async post(path: string, body: unknown): Promise<unknown> {
    const res = await this.fetchFn(`${ZAI_BASE_URL}${path}`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.opts.apiKey}` }, body: JSON.stringify(body),
    });
    if (!res.ok) throw new AIError(`Z.ai ${path} failed with ${res.status}`, await res.text().catch(() => undefined));
    return res.json();
  }

  async chatJSON<T>({ system, user, schema, images }: { system: string; user: string; schema: ZodType<T>; images?: string[] }): Promise<T> {
    const content = images?.length ? [...images.map(url => ({ type: "image_url", image_url: { url } })), { type: "text", text: user }] : user;
    const json = (await this.post("/chat/completions", {
      model: images?.length ? MODELS.vision : MODELS.text, temperature: 0.4,
      response_format: { type: "json_object" },
      // GLM-4.5 reasons out loud unless told not to, and Z.ai leaves that on by default. Both calls
      // here want one small JSON object from a one-paragraph prompt, and the chain of thought
      // preceding it cost more than everything else the shop waits for: measured against the live
      // API, the style call fell from ~45s to ~4s and the vision call from ~9s to ~2s, with the same
      // captions and palettes coming back. Turn it on again only for a prompt that needs deliberation.
      thinking: { type: "disabled" },
      messages: [{ role: "system", content: system }, { role: "user", content }],
    })) as { choices?: { message?: { content?: string } }[] };
    const raw = json.choices?.[0]?.message?.content ?? "";
    let parsed: unknown;
    try { parsed = JSON.parse(stripFences(raw)); } catch { throw new AIError("Z.ai returned non-JSON", raw); }
    const r = schema.safeParse(parsed);
    if (!r.success) throw new AIError(`Z.ai JSON failed validation: ${r.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ")}`, raw);
    return r.data;
  }

  async generateImage({ prompt, size = "1024x1024" }: { prompt: string; size?: string }): Promise<Buffer> {
    const json = (await this.post("/images/generations", { model: MODELS.image, prompt, size })) as { data?: { url?: string; b64_json?: string }[] };
    const d = json.data?.[0];
    if (d?.b64_json) return Buffer.from(d.b64_json, "base64");
    if (!d?.url) throw new AIError("Z.ai image response had no url", JSON.stringify(json));
    const img = await this.fetchFn(d.url);
    if (!img.ok) throw new AIError(`Downloading generated image failed with ${img.status}`);
    return Buffer.from(await img.arrayBuffer());
  }
}

let cached: AIProvider | undefined;
export function getProvider(): AIProvider {
  if (cached) return cached;
  const apiKey = process.env.ZAI_API_KEY;
  if (!apiKey) throw new AIError("ZAI_API_KEY is not set");
  return (cached = new ZaiProvider({ apiKey }));
}
export function setProviderForTests(p: AIProvider | undefined) { cached = p; }

/**
 * The provider, or a stand-in that is down.
 *
 * `getProvider` throws when there is no key, which is right for a caller that can do nothing
 * without a model and wrong for the ones that can. `chooseStyle` already answers a failed call with
 * a printable fallback style, and a batch already records a per-set error and carries on; both of
 * those are reached through a rejected promise, not through an exception at construction. So a
 * missing key is turned into the failure mode the callers are already written to survive, and a
 * deployment without `ZAI_API_KEY` degrades to the no-AI path instead of erroring at the door.
 *
 * The reason travels with it: every call rejects with the same error `getProvider` would have
 * thrown, so what the shop sees still names the missing key.
 */
export function providerOrDown(): AIProvider {
  try {
    return getProvider();
  } catch (e) {
    const reason = e instanceof Error ? e : new AIError(String(e));
    return {
      chatJSON: () => Promise.reject(reason),
      generateImage: () => Promise.reject(reason),
    };
  }
}
