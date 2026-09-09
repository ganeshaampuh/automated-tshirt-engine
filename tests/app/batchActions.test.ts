import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { rowsToInserts } from "@/lib/batchInserts";
import { parseBatchRows } from "@/lib/csv";

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
