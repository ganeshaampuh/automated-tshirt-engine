import Link from "next/link";
import { desc } from "drizzle-orm";
import { SetInputSchema } from "@/engine";
import { db, schema } from "@/db";
import { type BatchStatus, type SetStatus } from "@/lib/memberState";

export const dynamic = "force-dynamic";

const STATUS: Record<SetStatus, string> = {
  draft: "Draft",
  queued: "Antrean",
  processing: "Diproses",
  ready: "Siap",
  approved: "Disetujui",
  rejected: "Ditolak",
  failed: "Gagal",
};

const BATCH_STATUS: Record<BatchStatus, string> = {
  processing: "Diproses",
  ready: "Siap",
  exporting: "Diekspor",
  exported: "Selesai",
  failed: "Gagal",
};

function statusLabel(status: string): string {
  return status in STATUS ? STATUS[status as SetStatus] : status;
}

function batchStatusLabel(status: string): string {
  return status in BATCH_STATUS ? BATCH_STATUS[status as BatchStatus] : status;
}

const when = (d: Date) =>
  new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);

export default async function Home() {
  // The two lists are independent; a database that is down empties both rather than erroring the page.
  const [rows, batchRows] = await Promise.all([
    db.select().from(schema.sets).orderBy(desc(schema.sets.updatedAt)).limit(30).catch(() => []),
    db.select().from(schema.batches).orderBy(desc(schema.batches.updatedAt)).limit(10).catch(() => []),
  ]);

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-14">
      <header className="mb-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[26px] leading-tight font-medium">Kaos Ulang Tahun</h1>
          <p className="mt-1 text-[14px] text-muted">Nama anak, umur, dan tema jadi desain siap cetak untuk seluruh keluarga.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/batch/new"
            className="rounded-[var(--radius-ctl)] border border-rule bg-panel px-4 py-2 font-display text-[14px] text-ink transition-colors hover:bg-bench"
          >
            Batch dari CSV
          </Link>
          {/* A POST, not a link: opening this URL writes a draft row. */}
          <form action="/set/new" method="post">
            <button
              type="submit"
              className="rounded-[var(--radius-ctl)] bg-tape px-4 py-2 font-display text-[14px] text-ink transition-colors hover:bg-tape-dark hover:text-white"
            >
              Buat set baru
            </button>
          </form>
        </div>
      </header>

      {batchRows.length > 0 && (
        <section className="mb-10">
          <h2 className="font-display text-[15px]">Batch</h2>
          <p className="mt-0.5 mb-3 text-[13px] text-muted">Banyak set sekaligus dari satu file CSV.</p>
          <ul className="border-t border-rule">
            {batchRows.map(batch => (
              <li key={batch.id} className="border-b border-rule">
                <Link href={`/batch/${batch.id}`} className="flex items-baseline gap-3 px-1 py-3 transition-colors hover:bg-panel">
                  <span className="truncate font-display text-[15px]">{batch.name}</span>
                  <span className="shrink-0 text-[13px] text-muted">
                    {batch.setCount} set, {batch.readyCount} siap, {batch.approvedCount} disetujui
                    {batch.failedCount > 0 && `, ${batch.failedCount} gagal`}
                  </span>
                  <span className="ml-auto shrink-0 text-[12px] text-muted">{batchStatusLabel(batch.status)}</span>
                  <span className="w-[104px] shrink-0 text-right font-mono text-[12px] text-muted tabular-nums">
                    {when(batch.updatedAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="font-display text-[15px]">Set</h2>
        <p className="mt-0.5 mb-3 text-[13px] text-muted">Satu ulang tahun, satu desain per anggota keluarga.</p>
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
                    <span className="ml-auto text-[12px] text-muted">{statusLabel(row.status)}</span>
                    <span className="w-[104px] text-right font-mono text-[12px] text-muted tabular-nums">{when(row.updatedAt)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
