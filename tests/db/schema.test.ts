import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { unicornSet } from "../fixtures/set-unicorn";

describe.skipIf(!process.env.DATABASE_URL)("db: sets table", () => {
  it("inserts, reads back, and deletes a set row", async () => {
    const { db, schema } = await import("@/db");
    const fixture = unicornSet();

    const [inserted] = await db
      .insert(schema.sets)
      .values({ input: fixture.input, style: fixture.style })
      .returning();

    expect(inserted).toBeDefined();
    expect(inserted.status).toBe("draft");

    try {
      const [row] = await db
        .select()
        .from(schema.sets)
        .where(eq(schema.sets.id, inserted.id));

      expect(row).toBeDefined();
      expect(row.status).toBe("draft");
      const input = row.input as typeof fixture.input;
      expect(input.kidName).toBe("Keisya");
    } finally {
      await db.delete(schema.sets).where(eq(schema.sets.id, inserted.id));
    }
  });
});
