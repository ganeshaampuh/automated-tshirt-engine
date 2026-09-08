import Link from "next/link";
import { desc } from "drizzle-orm";
import { SetInputSchema } from "@/engine";
import { db, schema } from "@/db";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = { draft: "Draft", ready: "Siap", exported: "Sudah export", error: "Gagal" };

const when = (d: Date) =>
  new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);

export default async function Home() {
  const rows = await db.select().from(schema.sets).orderBy(desc(schema.sets.updatedAt)).limit(30).catch(() => []);

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-14">
      <header className="mb-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[26px] leading-tight font-medium">Kaos Ulang Tahun</h1>
          <p className="mt-1 text-[14px] text-muted">Satu set kaos keluarga, siap cetak.</p>
        </div>
        {/* A POST, not a link: opening this URL writes a draft row. */}
        <form action="/set/new" method="post">
          <button
            type="submit"
            className="rounded-[var(--radius-ctl)] bg-tape px-4 py-2 font-display text-[14px] text-ink transition-colors hover:bg-tape-dark hover:text-white"
          >
            Buat set baru
          </button>
        </form>
      </header>

      {rows.length === 0 ? (
        <p className="border border-dashed border-rule px-4 py-10 text-center text-[14px] text-muted">
          Belum ada set. Mulai dari nama anak dan temanya.
        </p>
      ) : (
        <ul className="border-t border-rule">
          {rows.map(row => {
            const parsed = SetInputSchema.safeParse(row.input);
            const input = parsed.success ? parsed.data : null;
            return (
              <li key={row.id} className="border-b border-rule">
                <Link href={`/set/${row.id}`} className="flex items-baseline gap-3 px-1 py-3 transition-colors hover:bg-panel">
                  {input && (
                    <span
                      aria-hidden
                      className="size-3 self-center rounded-full border border-rule"
                      style={{ background: input.shirtColor }}
                    />
                  )}
                  <span className="font-display text-[15px]">{input?.kidName ?? "Data rusak"}</span>
                  {input && (
                    <span className="text-[13px] text-muted">
                      {input.age} tahun, {input.members.length} kaos
                    </span>
                  )}
                  <span className="ml-auto text-[12px] text-muted">{STATUS[row.status] ?? row.status}</span>
                  <span className="w-[104px] text-right font-mono text-[12px] text-muted tabular-nums">{when(row.updatedAt)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
