import Link from "next/link";
import { desc } from "drizzle-orm";
import { SetInputSchema } from "@/engine";
import { db, schema } from "@/db";
import { RowDelete } from "@/app/components/RowDelete";
import { SetCards } from "@/app/components/SetCards";
import { ToastHost } from "@/app/components/ui";
import { groupByDay, timeOfDay } from "@/lib/dayGroups";
import { setTitle } from "@/lib/setTitle";
import { batchStatusLabel, statusLabel } from "@/lib/statusLabel";

export const dynamic = "force-dynamic";

/**
 * How the set list is drawn. It lives in the URL rather than in a client island: the page is
 * server-rendered, and a choice restored from `localStorage` after hydration would flip the whole
 * list from rows to cards in front of the shop on every visit. The cost is that the choice travels
 * with the link instead of being remembered — a bare `/` opens the rows.
 */
type SetView = "baris" | "kartu";
const SET_VIEW_PARAM = "set";

const setViewOf = (value: string | string[] | undefined): SetView => (value === "kartu" ? "kartu" : "baris");

const when = (d: Date) =>
  new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);

export default async function Home(props: PageProps<"/">) {
  const view = setViewOf((await props.searchParams)[SET_VIEW_PARAM]);
  // The two lists are independent; a database that is down empties both rather than erroring the page.
  const [rows, batchRows] = await Promise.all([
    db.select().from(schema.sets).orderBy(desc(schema.sets.updatedAt)).limit(30).catch(() => []),
    db.select().from(schema.batches).orderBy(desc(schema.batches.updatedAt)).limit(10).catch(() => []),
  ]);

  // Grouped once here rather than per-render: the rows already arrive newest first, so the groups
  // come out in that order too.
  const setDays = groupByDay(rows, row => row.updatedAt, new Date());

  return (
    // The lists are server-rendered; `ToastHost` is here so each row's delete has somewhere to
    // report what happened, and is the only client boundary the page opens.
    <ToastHost>
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
                // The delete sits beside the link, never inside it: one is a navigation, the other
                // cannot be undone, and a click must never be able to do both.
                <li key={batch.id} className="flex items-center gap-2 border-b border-rule pr-1">
                  <Link href={`/batch/${batch.id}`} className="flex flex-1 items-baseline gap-3 overflow-hidden px-1 py-3 transition-colors hover:bg-panel">
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
                  <RowDelete kind="batch" id={batch.id} name={batch.name} status={batch.status} />
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4">
            <div>
              <h2 className="font-display text-[15px]">Set</h2>
              <p className="mt-0.5 mb-3 text-[13px] text-muted">Satu ulang tahun, satu desain per anggota keluarga.</p>
            </div>
            {/* Two links, not a toggle: the switch is a different URL for the same page, so it needs
                no JavaScript and survives a reload. Hidden when there is nothing to draw either way. */}
            {rows.length > 0 && <SetViewSwitch view={view} />}
          </div>
          {rows.length === 0 ? (
            <p className="border border-dashed border-rule px-4 py-10 text-center text-[14px] text-muted">
              Belum ada set. Mulai dari nama anak dan temanya.
            </p>
          ) : view === "kartu" ? (
            <SetCards days={setDays} />
          ) : (
            // One list per day, each under its own heading. The row keeps only a clock time: the day
            // it belongs to is already stated above it.
            setDays.map(day => (
              <section key={day.key} className="mt-5 first:mt-0">
                <h3 className="pb-1.5 font-display text-[12px] tracking-wide text-muted uppercase">{day.label}</h3>
                <ul className="border-t border-rule">
                  {day.rows.map(row => {
                    const parsed = SetInputSchema.safeParse(row.input);
                    const input = parsed.success ? parsed.data : null;
                    const { title, subtitle } = setTitle(input);
                    return (
                      <li key={row.id} className="flex items-center gap-2 border-b border-rule pr-1">
                        <Link href={`/set/${row.id}`} className="flex flex-1 items-baseline gap-3 overflow-hidden px-1 py-3 transition-colors hover:bg-panel">
                          <span className="truncate font-display text-[15px]">{title}</span>
                          {input && (
                            <span className="shrink-0 text-[13px] text-muted">
                              {subtitle && `${subtitle} · `}
                              {input.age} tahun, {input.members.length} kaos
                            </span>
                          )}
                          <span className="ml-auto shrink-0 text-[12px] text-muted">{statusLabel(row.status)}</span>
                          <span className="w-[52px] shrink-0 text-right font-mono text-[12px] text-muted tabular-nums">
                            {timeOfDay(row.updatedAt)}
                          </span>
                        </Link>
                        {/* "Data rusak" is the name when the input will not parse — a row in exactly that
                            state is the one a shop most wants to be able to throw away. */}
                        <RowDelete kind="set" id={row.id} name={title} status={row.status} />
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </section>
      </div>
    </ToastHost>
  );
}

/** The row/card switch: the current view is stated, the other one is a link to itself. */
function SetViewSwitch({ view }: { view: SetView }) {
  const options: { value: SetView; label: string }[] = [
    { value: "baris", label: "Baris" },
    { value: "kartu", label: "Kartu" },
  ];
  return (
    <div className="mb-3 flex shrink-0 items-center overflow-hidden rounded-[var(--radius-ctl)] border border-rule bg-panel">
      {options.map(o =>
        o.value === view ? (
          <span key={o.value} aria-current="true" className="bg-bench px-2.5 py-1 font-display text-[12px] text-ink">
            {o.label}
          </span>
        ) : (
          <Link
            key={o.value}
            // `baris` is the default, so its link drops the parameter rather than spelling it out.
            href={o.value === "baris" ? "/" : `/?${SET_VIEW_PARAM}=${o.value}`}
            className="px-2.5 py-1 font-display text-[12px] text-muted transition-colors hover:bg-bench hover:text-ink"
          >
            {o.label}
          </Link>
        ),
      )}
    </div>
  );
}
