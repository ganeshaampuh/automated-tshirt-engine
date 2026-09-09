import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseCsv, parseBatchRows, parseMembers, MAX_SETS } from "@/lib/csv";
import { SetInputSchema } from "@/engine";

const sample = readFileSync("tests/fixtures/batch-sample.csv", "utf8");

describe("parseCsv", () => {
  it("handles quotes, escaped quotes and CRLF", () => {
    expect(parseCsv('a,b\r\n"x,1","he said ""hi"""\r\n')).toEqual([["a", "b"], ["x,1", 'he said "hi"']]);
  });
  it("keeps empty trailing fields", () => {
    expect(parseCsv("a,b,c\n1,,\n")).toEqual([["a", "b", "c"], ["1", "", ""]]);
  });
  it("ignores a trailing blank line", () => {
    expect(parseCsv("a\n1\n\n")).toEqual([["a"], ["1"]]);
  });
});

describe("parseMembers", () => {
  it("marks the birthday child and picks its class by age", () => {
    expect(parseMembers("Ayah:adult;Keisya:kid", 5).map(m => [m.label, m.kind, m.sizeClass]))
      .toEqual([["Ayah", "family", "adult"], ["Keisya", "birthday-kid", "kids-1-9"]]);
    expect(parseMembers("Bima:kid", 1)[0].sizeClass).toBe("kids-0-1");
    expect(parseMembers("Nadia:kid", 11)[0].sizeClass).toBe("adult");
  });
  it("gives every member a distinct id", () => {
    const ids = parseMembers("Ayah:adult;Ayah:adult;A:kid", 5).map(m => m.id);
    expect(new Set(ids).size).toBe(3);
  });
  it("refuses zero or several birthday children", () => {
    expect(() => parseMembers("Ayah:adult", 5)).toThrow(/satu anak ulang tahun/i);
    expect(() => parseMembers("A:kid;B:kid", 5)).toThrow(/satu anak ulang tahun/i);
  });
  it("refuses an unknown size class and a malformed token", () => {
    expect(() => parseMembers("Ayah:xl;A:kid", 5)).toThrow(/xl/);
    expect(() => parseMembers("Ayah;A:kid", 5)).toThrow(/Ayah/);
  });
});

describe("parseBatchRows", () => {
  it("parses the sample into valid SetInputs", () => {
    const { rows, errors } = parseBatchRows(sample);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(SetInputSchema.safeParse(r.input).success, `line ${r.line}`).toBe(true);
    expect(rows[0].input.members).toHaveLength(4);
    expect(rows[1].input.shirtColor).toBe("#1f2a44");           // "navy" resolved
    expect(rows[2].input.language).toBe("en");
  });

  it("reports the line number of a bad row and keeps the good ones", () => {
    const bad = "kid_name,age,theme,members\nKeisya,5,unicorn,Ayah:adult;Keisya:kid\nBima,notanumber,dino,Bima:kid\n";
    const { rows, errors } = parseBatchRows(bad);
    expect(rows).toHaveLength(1);
    expect(errors).toEqual([{ line: 3, message: expect.stringMatching(/umur/i) }]);
  });

  it("names a missing required column once, not per row", () => {
    const { rows, errors } = parseBatchRows("kid_name,age,theme\nKeisya,5,unicorn\n");
    expect(rows).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/members/);
  });

  it("refuses an empty file and a header-only file", () => {
    expect(parseBatchRows("").errors[0].message).toMatch(/kosong/i);
    expect(parseBatchRows("kid_name,age,theme,members\n").errors[0].message).toMatch(/tidak ada baris/i);
  });

  it("enforces the set cap", () => {
    const many = ["kid_name,age,theme,members", ...Array.from({ length: MAX_SETS + 1 }, (_, i) => `K${i},5,u,A:adult;K:kid`)].join("\n");
    expect(parseBatchRows(many).errors[0].message).toMatch(new RegExp(String(MAX_SETS)));
  });

  it("refuses a row whose clipart_url is not https", () => {
    const row = "kid_name,age,theme,members,clipart_url\nK,5,u,A:adult;K:kid,http://x/y.png\n";
    expect(parseBatchRows(row).errors[0].message).toMatch(/https/i);
  });
});
