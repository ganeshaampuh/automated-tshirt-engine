import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { rowsToInserts } from "@/lib/batchInserts";
import { parseBatchRows } from "@/lib/csv";
import { tickOrigin } from "@/lib/tickOrigin";

const { rows } = parseBatchRows(readFileSync("tests/fixtures/batch-sample.csv", "utf8"));

describe("rowsToInserts", () => {
  it("makes one queued set per row with every member queued", () => {
    const inserts = rowsToInserts("b1", rows);
    expect(inserts).toHaveLength(3);
    expect(inserts[0]).toMatchObject({ batchId: "b1", status: "queued" });
    expect(Object.values(inserts[0].memberStates!).every(s => s.status === "queued")).toBe(true);
    expect(Object.keys(inserts[0].memberStates!)).toEqual(rows[0].input.members.map(m => m.id));
  });

  it("carries each row's own input and members through untouched", () => {
    const inserts = rowsToInserts("b2", rows);
    expect(inserts.map(i => i.input.kidName)).toEqual(["Keisya", "Bima", "Nadia"]);
    expect(inserts.every(i => i.batchId === "b2")).toBe(true);
    expect(inserts.map(i => Object.keys(i.memberStates!).length)).toEqual([4, 3, 3]);
  });

  it("is pure: no rows in, no inserts out", () => {
    expect(rowsToInserts("b3", [])).toEqual([]);
  });
});

describe("tickOrigin", () => {
  const forged = { host: "169.254.169.254", proto: "http" };

  it("prefers the production URL Vercel set over any request header", () => {
    const env = { VERCEL_PROJECT_PRODUCTION_URL: "kaos.example.com", VERCEL_URL: "dep-1.vercel.app" };
    expect(tickOrigin(env, forged)).toBe("https://kaos.example.com");
  });

  it("falls back to the deployment URL, still ahead of the headers", () => {
    expect(tickOrigin({ VERCEL_URL: "dep-1.vercel.app" }, forged)).toBe("https://dep-1.vercel.app");
  });

  it("ignores a forged host in production and skips the kick instead", () => {
    expect(tickOrigin({ NODE_ENV: "production" }, forged)).toBe("");
    expect(tickOrigin({}, forged)).toBe("");
  });

  it("reads the request host only under next dev, where there is no proxy to forge through", () => {
    const dev = { NODE_ENV: "development" };
    expect(tickOrigin(dev, { host: "localhost:3000" })).toBe("http://localhost:3000");
    expect(tickOrigin(dev, { host: "127.0.0.1:3000" })).toBe("http://127.0.0.1:3000");
    expect(tickOrigin(dev, { host: "tunnel.example.com" })).toBe("https://tunnel.example.com");
    expect(tickOrigin(dev, {})).toBe("");
  });
});
