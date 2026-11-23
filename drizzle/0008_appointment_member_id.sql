-- ════════════════════════════════════════════════════════════════════════════
-- Literal `member_id` on the agenda history aggregates (brief 0076 AC-04, #1270).
--
-- AC-04 (owner's closed decision): the historical FKs reference the membership
-- DIRECTLY — `appointments`/`agenda_blocks` gain a `member_id` with a composite FK
-- `(org_id, member_id) → memberships(org_id, id)`. On appointments it is
-- `ON DELETE restrict` (NOT NULL): removing a membership that has appointment
-- history is refused by the DB, so the baixa is the `canBeBooked` capability
-- toggled off, never a delete (ADR 0010 immutability). On agenda_blocks it is
-- nullable + `ON DELETE set null` in lock-step with `member_operation_id` (a
-- whole-unit block belongs to no member).
--
-- This is the LITERAL, uniform model the brief fixes (every history row points at
-- the membership), complementing the transitive chain already shipped in !1328
-- (appointment → member_operations RESTRICT → memberships CASCADE). `member_id` is
-- DERIVED from the operational profile's `member_id` (the projector subquery), so
-- it is always consistent with the performer and never enters the event payload.
--
-- Backfill: the column is added nullable, populated by joining each history row to
-- its `member_operations` row (via `member_operation_id`), then — on appointments
-- only — constrained NOT NULL. Safe over existing rows.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Add the columns nullable ───────────────────────────────────────────────
ALTER TABLE "appointments" ADD COLUMN "member_id" text;--> statement-breakpoint
ALTER TABLE "agenda_blocks" ADD COLUMN "member_id" text;--> statement-breakpoint

-- ── 2. Backfill from the operational profile's member_id ──────────────────────
UPDATE "appointments" a
  SET "member_id" = mo."member_id"
  FROM "member_operations" mo
  WHERE mo."org_id" = a."org_id" AND mo."id" = a."member_operation_id"
    AND a."member_id" IS NULL;--> statement-breakpoint
UPDATE "agenda_blocks" b
  SET "member_id" = mo."member_id"
  FROM "member_operations" mo
  WHERE mo."org_id" = b."org_id" AND mo."id" = b."member_operation_id"
    AND b."member_id" IS NULL
    AND b."member_operation_id" IS NOT NULL;--> statement-breakpoint

-- ── 3. appointments.member_id is NOT NULL (every appointment has a performer) ──
ALTER TABLE "appointments" ALTER COLUMN "member_id" SET NOT NULL;--> statement-breakpoint

-- ── 4. Composite FKs to memberships ───────────────────────────────────────────
-- appointments: RESTRICT — a membership with appointment history can't be deleted.
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_member_id_fk" FOREIGN KEY ("org_id","member_id") REFERENCES "public"."memberships"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- agenda_blocks: SET NULL with the COLUMN-LIST form (PG15+) so only `member_id` is
-- nulled, never the NOT-NULL `org_id` (a bare composite SET NULL → 23502, mirrors
-- the `member_operation_id` FK). Drizzle can't emit the column-list form, so this
-- FK is hand-authored here.
ALTER TABLE "agenda_blocks" ADD CONSTRAINT "agenda_blocks_member_id_fk" FOREIGN KEY ("org_id","member_id") REFERENCES "public"."memberships"("org_id","id") ON DELETE SET NULL ("member_id") ON UPDATE no action;--> statement-breakpoint

-- ── 5. Index supporting the FK + the delete-guard lookup ──────────────────────
CREATE INDEX "appointments_org_id_member_id_idx" ON "appointments" USING btree ("org_id","member_id");
