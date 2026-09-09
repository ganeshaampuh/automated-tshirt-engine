import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { and, eq, sql } from "drizzle-orm";
import { AIError, getProvider, type AIProvider } from "@/ai";
import { createNodeMeasurer, loadImageFromFile } from "@/engine/server";
import { db, schema } from "@/db";
import { claimableSets } from "@/db/claimSets";
import { putBlob } from "@/lib/blob";
import { processSet, TICK_BATCH, type ProcessDeps, type ProcessResult } from "@/lib/processSet";
import { tickOrigin } from "@/lib/tickOrigin";

const { batches, sets } = schema;

export const dynamic = "force-dynamic";
/** Three sets of AI calls and mockups per tick; the chain, not one invocation, does the long haul. */
export const maxDuration = 60;

/**
 * The AI provider, or one that fails every call.
 *
 * A missing `ZAI_API_KEY` must not throw out of the tick: that would leave the claimed sets stuck in
 * `processing` forever with nothing recorded. Failing per call instead means a set with its own
 * `clipart_url` still finishes on the fallback style, and a set that needed generated clipart is
 * written down as `failed` with a reason the shop can act on.
 */
function tickProvider(): AIProvider {
  try {
    return getProvider();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[tick] no AI provider:", message);
    const down = async () => {
      throw new AIError(message);
    };
    return { chatJSON: down, generateImage: down };
  }
}

/**
 * What a real tick processes a set with: the live AI provider, Vercel Blob and the Node renderer.
 *
 * It is a function rather than a constant so nothing is built — and no provider is resolved — until
 * a request actually runs, and so the end-to-end database test can hand `POST` a stubbed set of
 * dependencies instead of reaching the network.
 */
function liveDeps(): ProcessDeps {
  return { provider: tickProvider(), putBlob, measure: createNodeMeasurer(), loadImage: loadImageFromFile };
}

/**
 * Re-invokes this route for the next slice of work.
 *
 * `tickOrigin` is used rather than the request's own URL because `host`/`x-forwarded-host` are
 * attacker input behind a proxy, and this call is made with the server's own credentials — see
 * `src/lib/tickOrigin.ts`. A kick that cannot be sent is logged and dropped: the progress so far is
 * already committed and the gallery's "Lanjutkan" starts a fresh chain.
 */
function chain(request: Request, id: string) {
  const origin =
    process.env.NODE_ENV === "development"
      ? tickOrigin(process.env, { host: request.headers.get("host"), proto: request.headers.get("x-forwarded-proto") })
      : tickOrigin(process.env);
  if (origin === "") {
    console.error(`[tick] no origin to continue batch ${id}; it waits for a manual resume`);
    return;
  }
  waitUntil(
    fetch(`${origin}/api/batch/${id}/tick`, { method: "POST" }).then(
      res => {
        if (!res.ok) console.error(`[tick] next tick for ${id} answered ${res.status}`);
      },
      e => console.error(`[tick] next tick for ${id} failed:`, e instanceof Error ? e.message : e),
    ),
  );
}

/** How many sets of this batch sit in each status right now. */
async function countByStatus(id: string) {
  const rows = await db
    .select({ status: sets.status, n: sql<number>`count(*)::int` })
    .from(sets)
    .where(eq(sets.batchId, id))
    .groupBy(sets.status);
  return (status: string) => rows.find(r => r.status === status)?.n ?? 0;
}

const writeFor = (setId: string, out: ProcessResult) =>
  db
    .update(sets)
    .set({
      status: out.status,
      aiFallback: out.aiFallback,
      error: out.error ?? null,
      memberStates: out.memberStates,
      updatedAt: new Date(),
      // A failed set has no style to write; whatever it already had stays put.
      ...(out.style ? { style: out.style } : {}),
    })
    .where(eq(sets.id, setId));

/**
 * One slice of a batch: claim up to `TICK_BATCH` queued sets, process them, write the results, and
 * re-invoke while queued sets remain.
 *
 * Self-chaining rather than cron because a Hobby plan runs cron once a day. All the progress lives
 * in the database, so an interrupted chain loses nothing: the next tick claims whatever is still
 * queued.
 *
 * `deps` is a seam for the end-to-end test only: Next.js calls this with two arguments, so a live
 * request always gets `liveDeps()`. It lets the database test prove the claim, the writes, the
 * roll-up and the chaining without spending a vision call, an LLM call and a blob upload per set —
 * the AI path itself is covered by the mocked-provider unit tests of `processSet`.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
  deps: ProcessDeps = liveDeps(),
) {
  const { id } = await ctx.params;

  const batch = await db.query.batches.findFirst({ where: eq(batches.id, id) });
  if (!batch) return NextResponse.json({ error: "Batch tidak ditemukan." }, { status: 404 });
  // `ready`, `exporting` and `exported` are all "the processing is over"; a tick that arrives late
  // (a duplicated kick, a stale chain) must not reopen the batch or start rendering into an export.
  if (batch.status !== "processing") {
    return NextResponse.json({ processed: 0, remaining: 0, status: batch.status, skipped: true });
  }

  const claimed = await db
    .update(sets)
    .set({ status: "processing", updatedAt: new Date() })
    .where(claimableSets(id, TICK_BATCH))
    .returning();

  // `processSet` never throws for an expected failure, so one bad set cannot reject this Promise.all
  // and strand the other two in `processing`.
  const results = await Promise.all(claimed.map(async row => [row.id, await processSet(row, deps)] as const));

  if (results.length > 0) {
    const writes = results.map(([setId, out]) => writeFor(setId, out));
    // `db.batch` wants a non-empty tuple; the length is checked right above.
    await db.batch(writes as [(typeof writes)[number], ...typeof writes]);
  }

  const count = await countByStatus(id);
  const [queued, processing] = [count("queued"), count("processing")];
  const rollUp = {
    readyCount: count("ready"),
    approvedCount: count("approved"),
    failedCount: count("failed"),
    updatedAt: new Date(),
  };
  // A batch is `ready` when nothing is queued or processing, whatever mix of ready/failed it holds.
  // While another tick still holds claimed sets, leave the verdict to whichever one finishes last.
  const done = queued === 0 && processing === 0;
  await db
    .update(batches)
    .set(done ? { ...rollUp, status: "ready" } : rollUp)
    // Still guarded on `processing`: an export may have started between the read above and here.
    .where(and(eq(batches.id, id), eq(batches.status, "processing")));

  if (queued > 0) chain(request, id);

  return NextResponse.json({ processed: results.length, remaining: queued });
}
