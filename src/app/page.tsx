import Link from "next/link";
import { desc } from "drizzle-orm";
import { SetInputSchema } from "@/engine";
import { db, schema } from "@/db";
import { Brand, ShirtGlyph } from "@/app/components/Brand";
import { RowDelete } from "@/app/components/RowDelete";
import { StatusChip } from "@/app/components/StatusChip";
import { DayHeading, SetCards } from "@/app/components/SetCards";
import { SetCheckbox, SetSelection } from "@/app/components/SetSelection";
import { isUnderway } from "@/app/batch/[id]/galleryRules";
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
      {/* The hero is a strip of the same cutting mat the editor lays designs on: the first thing the
          shop sees is the surface its work happens on. */}
      <header className="mat w-full">
        <div className="mx-auto w-full max-w-3xl px-6 pt-5 pb-10">
          <Brand onMat />
          <h1 className="mt-10 max-w-[18ch] font-display text-[36px] leading-[1.1] font-medium text-white sm:text-[44px]">
            Satu ulang tahun, satu set kaos keluarga.
          </h1>
          <p className="mt-3 max-w-[52ch] text-[15px] leading-relaxed text-white/70">
            Nama anak, umur, dan tema jadi desain siap cetak 300 DPI untuk setiap anggota keluarga.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-2">
            {/* A POST, not a link: opening this URL writes a draft row. */}
            <form action="/set/new" method="post">
              <button
                type="submit"
                className="rounded-[var(--radius-ctl)] bg-tape px-5 py-2.5 font-display text-[15px] text-ink transition-colors hover:bg-tape-dark hover:text-white"
              >
                Buat set baru
              </button>
            </form>
            <Link
              href="/batch/new"
              className="rounded-[var(--radius-ctl)] border border-white/25 px-5 py-2.5 font-display text-[15px] text-white transition-colors hover:bg-white/10"
            >
              Batch dari CSV
            </Link>
          </div>
        </div>
      </header>

      {/* Bottom room for the selection bar, so it never sits over the last row. */}
      <div className="mx-auto w-full max-w-3xl px-6 pt-10 pb-28">

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
                    <span className="hidden shrink-0 text-[13px] text-muted sm:inline">
                      {batch.setCount} set, {batch.readyCount} siap, {batch.approvedCount} disetujui
                      {batch.failedCount > 0 && `, ${batch.failedCount} gagal`}
                    </span>
                    <span className="ml-auto self-center">
                      <StatusChip status={batch.status} label={batchStatusLabel(batch.status)} />
                    </span>
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
              <p className="mt-0.5 mb-3 text-[13px] text-muted">Satu desain per anggota keluarga, tersimpan otomatis.</p>
            </div>
            {/* Two links, not a toggle: the switch is a different URL for the same page, so it needs
                no JavaScript and survives a reload. Hidden when there is nothing to draw either way. */}
            {rows.length > 0 && <SetViewSwitch view={view} />}
          </div>
          {/* Both views sit inside one selection, so ticks survive nothing but a reload. */}
          <SetSelection ids={rows.map(r => r.id)} underway={rows.filter(r => isUnderway(r.status)).map(r => r.id)}>
          {rows.length === 0 ? (
            <div className="grid place-items-center gap-2 rounded-[var(--radius-ctl)] border border-dashed border-rule px-4 py-12 text-center">
              <ShirtGlyph className="size-10 text-rule" />
              <p className="font-display text-[15px]">Belum ada set</p>
              <p className="text-[13px] text-muted">Tekan “Buat set baru” lalu isi nama anak dan temanya.</p>
            </div>
          ) : view === "kartu" ? (
            <SetCards days={setDays} />
          ) : (
            // One list per day, each under its own heading. The row keeps only a clock time: the day
            // it belongs to is already stated above it.
            setDays.map(day => (
              <section key={day.key} className="mt-5 first:mt-0">
                <DayHeading label={day.label} count={day.rows.length} />
                <ul className="border-t border-rule">
                  {day.rows.map(row => {
                    const parsed = SetInputSchema.safeParse(row.input);
                    const input = parsed.success ? parsed.data : null;
                    const { title, subtitle } = setTitle(input);
                    return (
                      <li key={row.id} className="flex items-center gap-2 border-b border-rule pr-1 pl-1">
                        {/* Beside the link, not inside it: a tick must never also open the set. */}
                        <SetCheckbox id={row.id} name={title} />
                        <Link href={`/set/${row.id}`} className="flex flex-1 items-center gap-3 overflow-hidden px-1 py-3 transition-colors hover:bg-panel">
                          {/* The shirt in the set's own colour: a white tee needs the outline to show at all. */}
                          <ShirtGlyph fill={input?.shirtColor ?? "var(--color-bench)"} stroke="var(--color-rule)" className="size-6 shrink-0" />
                          <span className="truncate font-display text-[15px]">{title}</span>
                          {input && (
                            <span className="hidden shrink-0 text-[13px] text-muted sm:inline">
                              {subtitle && `${subtitle} · `}
                              {input.age} tahun, {input.members.length} kaos
                            </span>
                          )}
                          <span className="ml-auto">
                            <StatusChip status={row.status} label={statusLabel(row.status)} />
                          </span>
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
          </SetSelection>
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
