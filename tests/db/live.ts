/**
 * Whether the specs that write into a real database and Blob store may run.
 *
 * Two conditions, not one. `DATABASE_URL` says a database is reachable; `ALLOW_DB_TESTS` says the
 * human meant it. Production, preview and development still share one Neon project (README,
 * "Known limitations"), so the connection string in any developer's `.env.local` is the shop's own
 * — and these specs create batches, sets, previews and ZIPs. Before this opt-in, merely having the
 * env loaded was enough to write into the live shop. The guard comes out once the environments are
 * split.
 *
 * `ALLOW_DB_TESTS=1` (or `true`) is the opt-in; anything else, including an empty value, is not.
 */
export const liveDb =
  Boolean(process.env.DATABASE_URL) && ["1", "true"].includes((process.env.ALLOW_DB_TESTS ?? "").toLowerCase());
