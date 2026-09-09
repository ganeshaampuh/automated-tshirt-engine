ALTER TABLE "batches" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "sets" ADD COLUMN "member_states" jsonb;--> statement-breakpoint
ALTER TABLE "sets" DROP COLUMN "preview_urls";