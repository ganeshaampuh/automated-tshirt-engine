import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import Gallery, { type GallerySet } from "./Gallery";

export const dynamic = "force-dynamic";

/**
 * The review gallery. It is re-rendered rather than subscribed to: the client calls
 * `router.refresh()` every few seconds while sets are still being drawn, which lands right here.
 */
export default async function BatchPage({ params }: PageProps<"/batch/[id]">) {
  const { id } = await params;
  const batch = await db.query.batches.findFirst({ where: eq(schema.batches.id, id) }).catch(() => undefined);
  if (!batch) notFound();

  const rows = await db
    .select({
      id: schema.sets.id,
      status: schema.sets.status,
      error: schema.sets.error,
      input: schema.sets.input,
      memberStates: schema.sets.memberStates,
    })
    .from(schema.sets)
    .where(eq(schema.sets.batchId, id))
    // Every set of a batch is inserted in one statement, so `created_at` is the same instant for all
    // of them; without the id as a tiebreaker Postgres is free to hand them back in a different order
    // after each verdict, and the cards would shuffle under the shop's cursor between polls.
    .orderBy(asc(schema.sets.createdAt), asc(schema.sets.id));

  return <Gallery batchId={batch.id} name={batch.name} batchStatus={batch.status} zipUrl={batch.zipUrl} sets={rows satisfies GallerySet[]} />;
}
