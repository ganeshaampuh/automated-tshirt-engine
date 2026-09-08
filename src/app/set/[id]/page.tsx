import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { SetInputSchema, SetStyleSchema } from "@/engine";
import { db, schema } from "@/db";
import SetEditor from "./SetEditor";

export const dynamic = "force-dynamic";

export default async function SetPage({ params }: PageProps<"/set/[id]">) {
  const { id } = await params;
  const row = await db.query.sets.findFirst({ where: eq(schema.sets.id, id) }).catch(() => undefined);
  if (!row) notFound();

  const input = SetInputSchema.safeParse(row.input);
  if (!input.success) notFound();
  const style = SetStyleSchema.safeParse(row.style ?? null);

  return <SetEditor initial={{ id: row.id, input: input.data, style: style.success ? style.data : null }} />;
}
