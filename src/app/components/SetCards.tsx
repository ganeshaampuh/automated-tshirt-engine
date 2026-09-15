import Link from "next/link";
import { SetInputSchema } from "@/engine";
import type { SetRow } from "@/db/schema";
import { RowDelete } from "@/app/components/RowDelete";
import { SetCheckbox } from "@/app/components/SetSelection";
import { ShirtThumb } from "@/app/components/ShirtThumb";
import { StatusChip } from "@/app/components/StatusChip";
import { type DayGroup, timeOfDay } from "@/lib/dayGroups";
import { setPreview } from "@/lib/setPreview";
import { setTitle } from "@/lib/setTitle";
import { statusLabel } from "@/lib/statusLabel";

/** A day's heading in both set views, with how many sets fall on it. */
export function DayHeading({ label, count }: { label: string; count: number }) {
  return (
    <h3 className="flex items-baseline gap-2 pb-2 font-display text-[13px] text-ink">
      {label}
      <span className="text-[12px] text-muted tabular-nums">{count} set</span>
    </h3>
  );
}

/**
 * The set list as a grid of thumbnails rather than a stack of rows.
 *
 * It is handed the same day groups the row list uses and keeps them, headings and order included:
 * the two views must differ in shape only. A card that quietly dropped the day boundaries would be
 * showing the shop a different list, not the same list drawn differently.
 *
 * Server-rendered like everything around it. `RowDelete` is the one client island, and it sits below
 * the link rather than inside it for the reason it always has: a click must never be able to both
 * navigate and delete.
 */
export function SetCards({ days }: { days: DayGroup<SetRow>[] }) {
  return (
    <>
      {days.map(day => (
        <section key={day.key} className="mt-5 first:mt-0">
          <DayHeading label={day.label} count={day.rows.length} />
          {/* One column on the narrowest phones: the footer strip below each card has to fit a
              status, a time and a delete on one line, and two columns at 400 px does not leave room
              for all three. */}
          <ul className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 sm:grid-cols-3">
            {day.rows.map(row => {
              const parsed = SetInputSchema.safeParse(row.input);
              const input = parsed.success ? parsed.data : null;
              const { title, subtitle } = setTitle(input);
              return (
                <li key={row.id} className="relative flex flex-col overflow-hidden rounded-[var(--radius-ctl)] border border-rule bg-panel transition-colors hover:border-muted">
                  {/* Over the thumbnail's corner but a sibling of the link, so a tick never opens the set. */}
                  <span className="absolute top-2 left-2 z-10 grid size-7 place-items-center rounded-[var(--radius-ctl)] bg-panel/90 ring-1 ring-rule">
                    <SetCheckbox id={row.id} name={title} />
                  </span>
                  <Link href={`/set/${row.id}`} className="block">
                    <ShirtThumb preview={setPreview({ ...row, input })} alt={`Kaos ${title}`} />
                    <div className="border-t border-rule px-2.5 py-2">
                      <p className="truncate font-display text-[14px] leading-tight">{title}</p>
                      <p className="mt-0.5 truncate text-[12px] text-muted">
                        {input ? (
                          <>
                            {subtitle && `${subtitle} · `}
                            {input.age} th, {input.members.length} kaos
                          </>
                        ) : (
                          "—"
                        )}
                      </p>
                      {input && <p className="mt-0.5 truncate text-[12px] text-muted">{input.theme}</p>}
                    </div>
                  </Link>
                  {/* Wraps on purpose: an armed `RowDelete` swaps its 64 px button for a confirm and
                      a cancel, which no card is wide enough to hold on one line beside the status
                      and the time. Wrapping drops the pair to its own row instead of overflowing. */}
                  <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-rule py-1 pr-1 pl-2.5">
                    <StatusChip status={row.status} label={statusLabel(row.status)} />
                    <span className="font-mono text-[12px] text-muted tabular-nums">{timeOfDay(row.updatedAt)}</span>
                    {/* "Data rusak" is the name when the input will not parse — a row in exactly that
                        state is the one a shop most wants to be able to throw away. */}
                    <div className="ml-auto">
                      <RowDelete kind="set" id={row.id} name={title} status={row.status} />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}
