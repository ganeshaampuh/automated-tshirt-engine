import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { claimableSets } from "@/db/claimSets";

const render = (chunk: Parameters<PgDialect["sqlToQuery"]>[0]) => new PgDialect().sqlToQuery(chunk);

describe("claimableSets", () => {
  const q = render(claimableSets("b1", 3));
  const flat = q.sql.replace(/\s+/g, " ");

  it("claims under FOR UPDATE SKIP LOCKED so two overlapping ticks cannot take the same set", () => {
    // Without this the chain and a manual "Lanjutkan" would render, store and bill every set twice.
    expect(flat).toContain("for update skip locked");
  });

  it("takes the oldest queued sets of one batch, and only that many", () => {
    expect(flat).toContain("s.status = 'queued'");
    expect(flat).toContain("order by s.created_at");
    expect(flat).toContain("limit $2");
    expect(q.params).toEqual(["b1", 3]);
  });

  it("filters the subquery on its own alias, not on the row being updated", () => {
    // `where "sets"."batch_id" = $1` inside the subquery would be a correlated reference to the
    // UPDATE's own row, which silently claims every queued set in the table.
    expect(flat).toContain("from \"sets\" s");
    expect(flat).toContain("s.batch_id = $1");
    expect(flat).not.toContain("\"sets\".\"batch_id\"");
  });

  it("binds the batch id rather than interpolating it", () => {
    const injected = render(claimableSets("' or true --", 3));
    expect(injected.sql).not.toContain("or true");
    expect(injected.params[0]).toBe("' or true --");
  });
});
