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

/**
 * The `where` of a resume's rescue: the sets of one batch that a dead tick left behind.
 *
 * A tick claims by moving rows to `processing`; if it then dies — a crash, a failed write, or
 * `maxDuration` running out mid-set — those rows stay `processing` forever, because `claimableSets`
 * only ever takes `queued` ones. The batch can then never reach `ready` and the gallery would poll
 * a batch that has no live work. `resumeBatchAction` puts such rows back in the queue.
 *
 * The age cut is what keeps this safe: a legitimate tick has at most `maxDuration` (60 s) to live,
 * so at five minutes there is no tick left that could still be working on the row. Anything younger
 * is left alone rather than raced.
 */
export function strandedSets(batchId: string, staleMinutes: number): SQL {
  return sql`${sets.batchId} = ${batchId} and ${sets.status} = 'processing'
    and ${sets.updatedAt} < now() - make_interval(mins => ${staleMinutes})`;
}
