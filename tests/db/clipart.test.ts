import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { clipartPatch } from "@/db/clipart";

const render = (chunk: Parameters<PgDialect["sqlToQuery"]>[0]) => new PgDialect().sqlToQuery(chunk);

describe("clipartPatch", () => {
  const patch = clipartPatch("https://blob.example/clipart/a.png");

  it("writes only the clipartSrc key of input, never the whole document", () => {
    const q = render(patch.input);
    expect(q.sql).toContain("jsonb_set");
    expect(q.sql).toContain("'{clipartSrc}'");
    expect(q.sql).toContain('"sets"."input"');
    // The stale `input` a slow clipart action read at its start must never come back this way.
    expect(q.sql).not.toContain("kidName");
    expect(q.params).toEqual(['"https://blob.example/clipart/a.png"']);
  });

  it("patches the style the same way, leaving a row with no style alone", () => {
    const q = render(patch.style);
    expect(q.sql).toContain("jsonb_set");
    expect(q.sql).toContain('"sets"."style"');
    // jsonb_set is strict: a NULL style stays NULL, so no branch is needed.
    expect(q.sql).not.toContain("CASE");
  });

  it("touches nothing else", () => {
    expect(Object.keys(patch).sort()).toEqual(["input", "style"]);
  });
});

describe.skipIf(!process.env.DATABASE_URL)("clipartPatch against Postgres", () => {
  it("keeps an edit that landed while the clipart action was still running", async () => {
    const { eq } = await import("drizzle-orm");
    const { db, schema } = await import("@/db");
    const { unicornSet } = await import("../fixtures/set-unicorn");
    const fixture = unicornSet();

    const [row] = await db
      .insert(schema.sets)
      .values({ input: fixture.input, style: fixture.style })
      .returning({ id: schema.sets.id });

    try {
      // The autosave lands a new name while the (slow) clipart action is still working.
      await db
        .update(schema.sets)
        .set({ input: { ...fixture.input, kidName: "Nama Baru" } })
        .where(eq(schema.sets.id, row.id));

      // The clipart action now writes its result, from state it read before that edit.
      await db.update(schema.sets).set(clipartPatch("https://blob.example/new.png")).where(eq(schema.sets.id, row.id));

      const [after] = await db.select().from(schema.sets).where(eq(schema.sets.id, row.id));
      expect(after.input.kidName).toBe("Nama Baru");
      expect(after.input.clipartSrc).toBe("https://blob.example/new.png");
      expect(after.style?.clipartSrc).toBe("https://blob.example/new.png");
    } finally {
      await db.delete(schema.sets).where(eq(schema.sets.id, row.id));
    }
  });
});
