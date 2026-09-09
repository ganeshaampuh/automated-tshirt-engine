import { pgTable, uuid, text, jsonb, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import type { SetInput, SetStyle } from "@/engine";
import type { MemberStates } from "@/lib/memberState";

export const sets = pgTable("sets", {
  id: uuid("id").primaryKey().defaultRandom(),
  batchId: uuid("batch_id"),
  status: text("status").notNull().default("draft"),
  input: jsonb("input").$type<SetInput>().notNull(),
  style: jsonb("style").$type<SetStyle>(),
  aiFallback: boolean("ai_fallback").notNull().default(false),
  error: text("error"),
  memberStates: jsonb("member_states").$type<MemberStates>(),
  exportUrl: text("export_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const batches = pgTable("batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  status: text("status").notNull().default("processing"),
  setCount: integer("set_count").notNull().default(0),
  readyCount: integer("ready_count").notNull().default(0),
  approvedCount: integer("approved_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  csvUrl: text("csv_url").notNull(),
  zipUrl: text("zip_url"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SetRow = typeof sets.$inferSelect;
export type BatchRow = typeof batches.$inferSelect;
