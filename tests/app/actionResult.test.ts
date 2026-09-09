import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { action, ActionError, UNEXPECTED_MESSAGE } from "@/lib/actionResult";

const source = readFileSync(path.join(__dirname, "..", "..", "src", "app", "actions", "sets.ts"), "utf8");

describe("action()", () => {
  it("wraps a value in a successful result", async () => {
    await expect(action(async () => 7)).resolves.toEqual({ ok: true, data: 7 });
  });

  it("returns an expected failure as data, message intact", async () => {
    const result = await action(async () => {
      throw new ActionError("Desain tidak ditemukan.");
    });
    expect(result).toEqual({ ok: false, message: "Desain tidak ditemukan." });
  });

  it("lets an unexpected fault keep throwing", async () => {
    await expect(action(async () => {
      throw new TypeError("boom");
    })).rejects.toThrow("boom");
  });

  it("has an Indonesian fallback for the fault it cannot describe", () => {
    expect(UNEXPECTED_MESSAGE).toMatch(/kesalahan/i);
  });
});

describe("set actions", () => {
  // React rewrites a message thrown out of a Server Action in production, so every user-facing
  // message must leave as a result. `fail` is the only way to raise one.
  it("never throws a user-facing message", () => {
    expect(source).not.toMatch(/throw new Error\(/);
  });

  it("returns an ActionResult from every exported action", () => {
    const exported = [...source.matchAll(/export async function (\w+)[\s\S]*?\): (Promise<[^{]+)/g)];
    expect(exported.length).toBeGreaterThan(0);
    for (const [, name, signature] of exported) {
      expect(`${name}: ${signature}`).toContain("ActionResult<");
    }
  });
});

describe("exportSetAction", () => {
  // Export records itself in `exportUrl`. Writing `status` too would demote an approved set the
  // moment someone re-exported it.
  it("does not write status", () => {
    const body = source.slice(source.indexOf("export async function exportSetAction"));
    expect(body).toContain("exportUrl: zipUrl");
    expect(body).not.toMatch(/status:/);
  });
});

describe("home page status map", () => {
  const page = readFileSync(path.join(__dirname, "..", "..", "src", "app", "page.tsx"), "utf8");

  // Scoped to the *set* map: a batch has its own vocabulary next to it, and "exported" is a real
  // batch status. A set never reaches it, so the set map must still not offer it.
  const setMap = page.slice(page.indexOf("const STATUS"), page.indexOf("const BATCH_STATUS"));

  it("lists no set status the app never writes", () => {
    expect(setMap).toContain("draft:");
    expect(setMap).not.toContain("exported:");
  });
});
