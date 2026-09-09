import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { PgDialect } from "drizzle-orm/pg-core";
import { strandedSets } from "@/db/claimSets";
import { STALE_CLAIM_MINUTES, TICK_MAX_SECONDS } from "@/lib/processSet";
import {
  approvable,
  galleryCounts,
  isBusy,
  isUnderway,
  progressLine,
  resumeOffered,
  statusSignature,
} from "@/app/batch/[id]/galleryRules";

const rows = (...statuses: string[]) => statuses.map((status, i) => ({ id: `s${i + 1}`, status }));

describe("galleryCounts", () => {
  it("counts every status a set can be in", () => {
    const counts = galleryCounts(rows("queued", "processing", "ready", "ready", "approved", "rejected", "failed"));
    expect(counts).toEqual({ total: 7, queued: 1, processing: 1, ready: 2, approved: 1, rejected: 1, failed: 1 });
  });

  it("is zero all the way down for an empty batch", () => {
    expect(galleryCounts([])).toEqual({ total: 0, queued: 0, processing: 0, ready: 0, approved: 0, rejected: 0, failed: 0 });
  });

  it("ignores a status it does not know rather than throwing", () => {
    const counts = galleryCounts(rows("draft", "ready"));
    expect(counts).toMatchObject({ total: 2, ready: 1, queued: 0 });
  });
});

describe("isBusy", () => {
  it("is true while any set is queued or processing, so the page keeps polling", () => {
    expect(isBusy(galleryCounts(rows("ready", "queued")))).toBe(true);
    expect(isBusy(galleryCounts(rows("ready", "processing")))).toBe(true);
  });

  it("is false once nothing is left to wait for, so the polling stops", () => {
    expect(isBusy(galleryCounts(rows("ready", "approved", "rejected", "failed")))).toBe(false);
    expect(isBusy(galleryCounts([]))).toBe(false);
  });
});

describe("progressLine", () => {
  it("reads like the shop's own sentence", () => {
    expect(progressLine(galleryCounts(rows("ready", "ready", "approved", "failed")))).toBe(
      "3 dari 4 set siap · 1 disetujui · 1 gagal",
    );
  });

  it("counts an approved or rejected set as one that got there", () => {
    expect(progressLine(galleryCounts(rows("queued", "approved", "rejected")))).toBe(
      "2 dari 3 set siap · 1 disetujui · 1 ditolak",
    );
  });

  it("drops the tails that are zero", () => {
    expect(progressLine(galleryCounts(rows("queued", "ready")))).toBe("1 dari 2 set siap");
  });
});

describe("approvable", () => {
  const batch = [
    { id: "a", status: "ready" },
    { id: "b", status: "failed" },
    { id: "c", status: "approved" },
    { id: "d", status: "queued" },
    { id: "e", status: "ready" },
  ];

  it("advances only the sets that are ready right now", () => {
    expect(approvable(["a", "e"], batch)).toEqual(["a", "e"]);
  });

  it("ignores a failed set instead of approving it", () => {
    expect(approvable(["a", "b"], batch)).toEqual(["a"]);
  });

  it("ignores a set that is already approved, so the count never double-counts it", () => {
    expect(approvable(["c"], batch)).toEqual([]);
  });

  it("ignores a set that has not finished processing, and an id it was never shown", () => {
    // Note what this does *not* pin: the rows handed in are whatever the caller read, so an id from
    // another batch is dropped only because it is missing from `rows`, not because of any scoping.
    expect(approvable(["d", "zz"], batch)).toEqual([]);
  });

  it("takes each id once, whatever the caller sent", () => {
    expect(approvable(["a", "a"], batch)).toEqual(["a"]);
  });
});

describe("statusSignature", () => {
  it("changes when any set moves on, which is what tells the poll something happened", () => {
    const before = statusSignature(rows("queued", "queued"));
    expect(statusSignature(rows("queued", "queued"))).toBe(before);
    expect(statusSignature(rows("queued", "ready"))).not.toBe(before);
  });

  it("changes when a set's previews arrive even though its status has not", () => {
    const bare = [{ id: "a", status: "processing" }];
    const drawn = [{ id: "a", status: "processing", memberStates: { m1: { status: "ready" as const } } }];
    expect(statusSignature(drawn)).not.toBe(statusSignature(bare));
  });
});

describe("strandedSets", () => {
  const q = new PgDialect().sqlToQuery(strandedSets("b1", 5));
  const flat = q.sql.replace(/\s+/g, " ");

  it("takes only the sets of this batch that a dead tick left claimed", () => {
    // `claimableSets` sees `queued` rows alone, so without this rescue a stranded row is never
    // drawn again and the batch can never reach `ready`.
    expect(flat).toContain('"batch_id" = $1');
    expect(flat).toContain(`"status" = 'processing'`);
  });

  it("leaves a claim younger than the cut-off alone, so a live tick is never robbed", () => {
    expect(flat).toContain('"updated_at" < now() - make_interval(mins => $2)');
    expect(q.params).toEqual(["b1", 5]);
  });

  it("binds the batch id rather than interpolating it", () => {
    const injected = new PgDialect().sqlToQuery(strandedSets("' or true --", 5));
    expect(injected.sql).not.toContain("or true");
    expect(injected.params[0]).toBe("' or true --");
  });
});

describe("isUnderway", () => {
  it("is true for the two statuses a tick may be holding the row in", () => {
    expect(isUnderway("queued")).toBe(true);
    expect(isUnderway("processing")).toBe(true);
  });

  it("is false once the row is the shop's to judge", () => {
    for (const status of ["ready", "approved", "rejected", "failed", "draft"]) {
      expect(isUnderway(status)).toBe(false);
    }
  });
});

describe("resumeOffered", () => {
  it("offers the resume while any set is queued or processing", () => {
    expect(resumeOffered(galleryCounts(rows("ready", "queued")), "processing")).toBe(true);
    expect(resumeOffered(galleryCounts(rows("ready", "processing")), "processing")).toBe(true);
  });

  it("still offers it for a batch left open with nothing left to do", () => {
    // A tick that died between its writes and its roll-up leaves exactly this: every set settled,
    // the batch row still `processing`. Without the button the batch could never be closed.
    expect(resumeOffered(galleryCounts(rows("ready", "approved")), "processing")).toBe(true);
  });

  it("stays out of the way once the batch is closed", () => {
    expect(resumeOffered(galleryCounts(rows("ready", "approved")), "ready")).toBe(false);
    expect(resumeOffered(galleryCounts(rows("approved")), "exported")).toBe(false);
  });
});

/**
 * The rescue's safety argument in two files: a route's `maxDuration` and the age a resume calls a
 * claim dead. Raising the budget without the window would let a resume requeue a set a live tick is
 * still drawing, and the same set would be rendered — and billed — twice.
 */
describe("tick budget", () => {
  it("keeps the stale-claim window at least twice the tick's own budget", () => {
    expect(STALE_CLAIM_MINUTES * 60).toBeGreaterThanOrEqual(TICK_MAX_SECONDS * 2);
  });

  // Next.js reads a route's `maxDuration` without running the file, so it cannot be the imported
  // constant; this is what keeps the copy honest.
  it.each(["tick", "export"])("holds the %s route's maxDuration to that same budget", route => {
    const src = readFileSync(`src/app/api/batch/[id]/${route}/route.ts`, "utf8");
    // Anchored to the start of a line: a commented-out or shadowed copy must not satisfy the pin.
    expect(src).toMatch(new RegExp(`^export const maxDuration = ${TICK_MAX_SECONDS};$`, "m"));
  });
});
