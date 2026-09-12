/**
 * Bins rows into the calendar days they fall on, for lists that are already sorted newest first.
 *
 * The day is the one the shop is standing in, not the one the server is: Vercel runs in UTC, so a
 * set saved at 6am in Jakarta belongs to a day that UTC has not reached yet. Every boundary here is
 * therefore drawn in `SHOP_TIME_ZONE` rather than by arithmetic on the runtime's local clock.
 */
const SHOP_TIME_ZONE = "Asia/Jakarta";

export type DayGroup<T> = {
  /** The Jakarta calendar day as `YYYY-MM-DD` — stable across renders, so it keys a list. */
  key: string;
  label: string;
  rows: T[];
};

// `en-CA` is the shortest route to a `YYYY-MM-DD` day key; the visible label is formatted in id-ID.
const dayKeyOf = new Intl.DateTimeFormat("en-CA", {
  timeZone: SHOP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const dateLabelOf = new Intl.DateTimeFormat("id-ID", {
  timeZone: SHOP_TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** The time of day alone; the date lives in the group heading above the row. */
export const timeOfDay = new Intl.DateTimeFormat("id-ID", {
  timeZone: SHOP_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
}).format;

const dayBefore = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return dayKeyOf.format(new Date(Date.UTC(y, m - 1, d - 1, 12)));
};

/**
 * Groups consecutive rows sharing a day, preserving the order they arrived in — both within a group
 * and between them. Rows from one day that are not adjacent open separate groups rather than being
 * pulled together, so a list is never silently reordered by being grouped.
 */
export function groupByDay<T>(rows: readonly T[], at: (row: T) => Date, now: Date): DayGroup<T>[] {
  const today = dayKeyOf.format(now);
  const yesterday = dayBefore(today);

  const groups: DayGroup<T>[] = [];
  for (const row of rows) {
    const date = at(row);
    const key = dayKeyOf.format(date);
    const open = groups.at(-1);
    if (open?.key === key) {
      open.rows.push(row);
      continue;
    }
    const label = key === today ? "Hari ini" : key === yesterday ? "Kemarin" : dateLabelOf.format(date);
    groups.push({ key, label, rows: [row] });
  }
  return groups;
}
