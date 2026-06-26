ALTER TABLE "appointments" ALTER COLUMN "start_at" SET DATA TYPE timestamp with time zone USING "start_at"::timestamptz;--> statement-breakpoint
ALTER TABLE "appointments" ALTER COLUMN "end_at" SET DATA TYPE timestamp with time zone USING "end_at"::timestamptz;--> statement-breakpoint
-- Anti-double-book at the database (brief 0061 § Grupo C / #843): no two
-- `scheduled` appointments for the SAME org + professional may have overlapping
-- [start_at, end_at) intervals. `btree_gist` lets the equality columns
-- (org_id/professional_id) share a GiST index with the range overlap operator.
-- The half-open `[)` range matches the domain `intervalsOverlap`
-- (a.start < b.end && b.start < a.end). A violating INSERT raises 23P01
-- (exclusion_violation) and the booking tx rolls back → `slot_taken`.
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_no_double_book"
  EXCLUDE USING gist (
    "org_id" WITH =,
    "professional_id" WITH =,
    tstzrange("start_at", "end_at", '[)') WITH &&
  ) WHERE ("status" = 'scheduled');
