import { describe, it, expect } from "vitest";
import { groupByDay, timeOfDay } from "@/lib/dayGroups";

type Row = { id: string; at: Date };
const row = (id: string, iso: string): Row => ({ id, at: new Date(iso) });
const group = (rows: Row[], now: string) => groupByDay(rows, r => r.at, new Date(now));
const ids = (g: { rows: Row[] }) => g.rows.map(r => r.id);

describe("groupByDay", () => {
  it("bins rows by the day the shop is standing in, not the one UTC is", () => {
    // 06:00 in Jakarta is 23:00 the previous day in UTC. Grouping on the runtime's clock would file
    // this set under a day the shop has already finished.
    const rows = [row("pagi", "2026-09-12T06:00:00+07:00")];
    const [g] = group(rows, "2026-09-12T10:00:00+07:00");
    expect(g.key).toBe("2026-09-12");
    expect(g.label).toBe("Hari ini");
  });

  it("keeps a late-evening row on its own Jakarta day", () => {
    // 23:30 Jakarta is already the next day in UTC — the mirror of the case above.
    const rows = [row("malam", "2026-09-12T23:30:00+07:00")];
    expect(group(rows, "2026-09-12T23:45:00+07:00")[0].key).toBe("2026-09-12");
  });

  it("gathers consecutive rows from one day into a single group", () => {
    const rows = [
      row("c", "2026-09-12T17:00:00+07:00"),
      row("b", "2026-09-12T11:00:00+07:00"),
      row("a", "2026-09-12T09:00:00+07:00"),
    ];
    const groups = group(rows, "2026-09-12T18:00:00+07:00");
    expect(groups).toHaveLength(1);
    expect(ids(groups[0])).toEqual(["c", "b", "a"]);
  });

  it("preserves the order rows arrived in, within groups and between them", () => {
    const rows = [
      row("today-2", "2026-09-12T17:00:00+07:00"),
      row("today-1", "2026-09-12T09:00:00+07:00"),
      row("older", "2026-09-10T09:00:00+07:00"),
    ];
    const groups = group(rows, "2026-09-12T18:00:00+07:00");
    expect(groups.map(g => g.key)).toEqual(["2026-09-12", "2026-09-10"]);
    expect(groups.map(ids)).toEqual([["today-2", "today-1"], ["older"]]);
  });

  it("opens a second group rather than reordering a list that is out of sequence", () => {
    // Grouping must not silently rearrange rows: a list sorted by something other than time would
    // come back in an order the shop did not ask for.
    const rows = [
      row("a", "2026-09-12T09:00:00+07:00"),
      row("b", "2026-09-10T09:00:00+07:00"),
      row("c", "2026-09-12T08:00:00+07:00"),
    ];
    const groups = group(rows, "2026-09-12T18:00:00+07:00");
    expect(groups.map(g => g.key)).toEqual(["2026-09-12", "2026-09-10", "2026-09-12"]);
    expect(groups.map(ids)).toEqual([["a"], ["b"], ["c"]]);
  });

  it("names today and yesterday, and dates anything older", () => {
    const rows = [
      row("t", "2026-09-12T09:00:00+07:00"),
      row("y", "2026-09-11T09:00:00+07:00"),
      row("o", "2026-09-10T09:00:00+07:00"),
    ];
    const groups = group(rows, "2026-09-12T18:00:00+07:00");
    expect(groups[0].label).toBe("Hari ini");
    expect(groups[1].label).toBe("Kemarin");
    // The month's spelling is ICU's business; that the label carries the day and year is ours.
    expect(groups[2].label).toMatch(/^10 .*2026$/);
  });

  it("finds yesterday across a month boundary", () => {
    const rows = [row("y", "2026-08-31T20:00:00+07:00")];
    expect(group(rows, "2026-09-01T09:00:00+07:00")[0].label).toBe("Kemarin");
  });

  it("keys every group as a sortable calendar day", () => {
    const rows = [row("a", "2026-09-12T09:00:00+07:00"), row("b", "2026-01-02T09:00:00+07:00")];
    for (const g of group(rows, "2026-09-12T18:00:00+07:00")) expect(g.key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns nothing for an empty list", () => {
    expect(group([], "2026-09-12T18:00:00+07:00")).toEqual([]);
  });
});

describe("timeOfDay", () => {
  it("reads the clock in Jakarta, whatever the server's zone", () => {
    // The date lives in the group heading, so the row shows only the time — and it has to be the
    // time the shop remembers saving the set.
    expect(timeOfDay(new Date("2026-09-12T06:05:00+07:00"))).toMatch(/06[.:]05/);
  });
});
