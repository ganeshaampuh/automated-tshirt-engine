import { sql, type SQL } from "drizzle-orm";
import { sets } from "./schema";

/**
 * The `where` of a tick's claim: the next `limit` queued sets of one batch, locked as they are read.
 *
 * `FOR UPDATE SKIP LOCKED` is the whole point. Two ticks can overlap — the chain re-invokes itself
 * while the gallery's "Lanjutkan" button may start a second one — and without the lock both would
 * read the same queued rows and render, store and bill for every set twice. A locked row is skipped
 * rather than waited for, so the second tick simply takes the next three.
 *
 * The subquery aliases the table (`sets s`) on purpose: unaliased, its `where` would read as a
 * correlated reference to the row being updated instead of a filter on the candidates.
 */
export function claimableSets(batchId: string, limit: number): SQL {
  return sql`${sets.id} in (
    select s.id from ${sets} s
    where s.batch_id = ${batchId} and s.status = 'queued'
    order by s.created_at
    limit ${limit}
    for update skip locked
  )`;
}
