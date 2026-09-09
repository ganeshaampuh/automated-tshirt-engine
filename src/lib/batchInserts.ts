import type { ParsedRow } from "@/lib/csv";
import { initialStates } from "@/lib/memberState";
import type { MemberStates } from "@/lib/memberState";
import type { SetInput } from "@/engine";
import type { SetStatus } from "@/lib/memberState";

export type SetInsert = { batchId: string; status: SetStatus; input: SetInput; memberStates: MemberStates };

/**
 * The rows of a validated CSV turned into `sets` insert payloads: every set starts `queued`, and so
 * does every one of its members, in the row's own member order.
 *
 * It lives here rather than beside the action because a `"use server"` module may export only async
 * functions, and because importing that module would open a database connection — this mapping is
 * the part worth pinning in a test, and it must be testable without one.
 */
export function rowsToInserts(batchId: string, rows: ParsedRow[]): SetInsert[] {
  return rows.map(row => ({
    batchId,
    status: "queued",
    input: row.input,
    memberStates: initialStates(row.input.members.map(m => m.id)),
  }));
}
