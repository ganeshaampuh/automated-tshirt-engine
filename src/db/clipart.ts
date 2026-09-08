import { sql } from "drizzle-orm";
import { sets } from "./schema";

/**
 * The update patch that stores a new clipart URL.
 *
 * Written as two `jsonb_set` calls rather than a whole-document write on purpose: a clipart action
 * can spend ten seconds in image generation, and re-writing the `input` it read at the start would
 * put a stale name back over whatever the autosave landed in the meantime. This touches the one
 * key it owns and leaves every other field to the client.
 *
 * `jsonb_set` is strict, so a row with no style yet keeps its NULL style — no branch needed.
 */
export function clipartPatch(url: string) {
  const value = sql`${JSON.stringify(url)}::jsonb`;
  return {
    input: sql`jsonb_set(${sets.input}, '{clipartSrc}', ${value})`,
    style: sql`jsonb_set(${sets.style}, '{clipartSrc}', ${value})`,
  };
}
