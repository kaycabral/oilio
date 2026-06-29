-- ════════════════════════════════════════════════════════════════════════════
-- Canonical rename `professional` → `member_operation` / `member_operator`
-- (brief 0076 § "Decisões fechadas", #1271 + #1264 wave).
--
-- The 0076 model makes "being operational/bookable" a CAPABILITY a member can
-- carry, not a class of person. This migration completes the rename across the
-- whole stack so the schema, the RBAC role, and the event log all speak the same
-- vocabulary — no hybrid, no drift:
--
--   • the operational-profile table family `professionals*` → `member_operations*`
--   • the performer-ref columns on the agenda aggregates `professional_id` /
--     `professional_user_id` → `member_operation_id` / `member_operator_user_id`
--   • the own-scope RLS GUC `app.current_professional` → `app.current_member_operation`
--   • the RBAC role `professional` → `member_operator` (memberships + invites CHECK)
--   • the capability key `canManageProfessionals` → `canManageOperators` (JSONB)
--   • the event log: `aggregate_type` + `_tag` + the appointment payload field.
--
-- Hand-authored as `ALTER TABLE ... RENAME` + targeted `UPDATE` (NOT drizzle-kit
-- push/drop+add): renames preserve every row, FK, index and policy in place. The
-- event-log rewrite is safe because oilio is pre-prod with no production data
-- (PRD § "Migração de dado histórico"); it is correct for any local dump too.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Performer-ref column renames on the agenda aggregates ──────────────────
ALTER TABLE "appointments" RENAME COLUMN "professional_id" TO "member_operation_id";--> statement-breakpoint
ALTER TABLE "appointments" RENAME COLUMN "professional_user_id" TO "member_operator_user_id";--> statement-breakpoint
ALTER TABLE "agenda_blocks" RENAME COLUMN "professional_id" TO "member_operation_id";--> statement-breakpoint

-- ── 2. Join-table FK column rename: professional_id → member_operation_id ──────
ALTER TABLE "professional_units" RENAME COLUMN "professional_id" TO "member_operation_id";--> statement-breakpoint
ALTER TABLE "professional_services" RENAME COLUMN "professional_id" TO "member_operation_id";--> statement-breakpoint

-- ── 3. Table renames (rows, FK targets, RLS enablement preserved) ─────────────
ALTER TABLE "professionals" RENAME TO "member_operations";--> statement-breakpoint
ALTER TABLE "professionals_pii" RENAME TO "member_operations_pii";--> statement-breakpoint
ALTER TABLE "professional_units" RENAME TO "member_operation_units";--> statement-breakpoint
ALTER TABLE "professional_services" RENAME TO "member_operation_services";--> statement-breakpoint

-- ── 4. member_operations — constraints + indexes + policy ─────────────────────
ALTER TABLE "member_operations" RENAME CONSTRAINT "professionals_pkey" TO "member_operations_pkey";--> statement-breakpoint
ALTER TABLE "member_operations" RENAME CONSTRAINT "professionals_user_id_nonempty" TO "member_operations_user_id_nonempty";--> statement-breakpoint
ALTER TABLE "member_operations" RENAME CONSTRAINT "professionals_member_id_nonempty" TO "member_operations_member_id_nonempty";--> statement-breakpoint
ALTER TABLE "member_operations" RENAME CONSTRAINT "professionals_org_id_fk" TO "member_operations_org_id_fk";--> statement-breakpoint
ALTER TABLE "member_operations" RENAME CONSTRAINT "professionals_member_id_fk" TO "member_operations_member_id_fk";--> statement-breakpoint
ALTER INDEX "professionals_org_id_user_id_idx" RENAME TO "member_operations_org_id_user_id_idx";--> statement-breakpoint
ALTER INDEX "professionals_org_id_member_id_idx" RENAME TO "member_operations_org_id_member_id_idx";--> statement-breakpoint
ALTER POLICY "professionals_org_isolation" ON "member_operations" RENAME TO "member_operations_org_isolation";--> statement-breakpoint

-- ── 5. member_operations_pii — constraints + indexes + policy ─────────────────
ALTER TABLE "member_operations_pii" RENAME CONSTRAINT "professionals_pii_pkey" TO "member_operations_pii_pkey";--> statement-breakpoint
ALTER TABLE "member_operations_pii" RENAME CONSTRAINT "professionals_pii_org_id_fk" TO "member_operations_pii_org_id_fk";--> statement-breakpoint
ALTER INDEX "professionals_pii_org_id_idx" RENAME TO "member_operations_pii_org_id_idx";--> statement-breakpoint
ALTER POLICY "professionals_pii_org_isolation" ON "member_operations_pii" RENAME TO "member_operations_pii_org_isolation";--> statement-breakpoint

-- ── 6. member_operation_units — constraints + indexes + policy ────────────────
ALTER TABLE "member_operation_units" RENAME CONSTRAINT "professional_units_org_id_professional_id_unit_id_pk" TO "member_operation_units_org_id_member_operation_id_unit_id_pk";--> statement-breakpoint
ALTER TABLE "member_operation_units" RENAME CONSTRAINT "professional_units_org_id_fk" TO "member_operation_units_org_id_fk";--> statement-breakpoint
ALTER TABLE "member_operation_units" RENAME CONSTRAINT "professional_units_professional_id_fk" TO "member_operation_units_member_operation_id_fk";--> statement-breakpoint
ALTER TABLE "member_operation_units" RENAME CONSTRAINT "professional_units_unit_id_fk" TO "member_operation_units_unit_id_fk";--> statement-breakpoint
ALTER INDEX "professional_units_org_id_unit_id_idx" RENAME TO "member_operation_units_org_id_unit_id_idx";--> statement-breakpoint
ALTER POLICY "professional_units_org_isolation" ON "member_operation_units" RENAME TO "member_operation_units_org_isolation";--> statement-breakpoint

-- ── 7. member_operation_services — constraints + indexes + policy ─────────────
ALTER TABLE "member_operation_services" RENAME CONSTRAINT "professional_services_org_id_professional_id_service_id_pk" TO "member_operation_services_org_id_member_op_service_pk";--> statement-breakpoint
ALTER TABLE "member_operation_services" RENAME CONSTRAINT "professional_services_org_id_fk" TO "member_operation_services_org_id_fk";--> statement-breakpoint
ALTER TABLE "member_operation_services" RENAME CONSTRAINT "professional_services_professional_id_fk" TO "member_operation_services_member_operation_id_fk";--> statement-breakpoint
ALTER TABLE "member_operation_services" RENAME CONSTRAINT "professional_services_service_id_fk" TO "member_operation_services_service_id_fk";--> statement-breakpoint
ALTER INDEX "professional_services_org_id_service_id_idx" RENAME TO "member_operation_services_org_id_service_id_idx";--> statement-breakpoint
ALTER POLICY "professional_services_org_isolation" ON "member_operation_services" RENAME TO "member_operation_services_org_isolation";--> statement-breakpoint

-- ── 8. Appointments/agenda performer-ref FK + index renames ───────────────────
ALTER TABLE "appointments" RENAME CONSTRAINT "appointments_professional_id_fk" TO "appointments_member_operation_id_fk";--> statement-breakpoint
ALTER INDEX "appointments_org_id_professional_idx" RENAME TO "appointments_org_id_member_operation_idx";--> statement-breakpoint
ALTER TABLE "agenda_blocks" RENAME CONSTRAINT "agenda_blocks_professional_id_fk" TO "agenda_blocks_member_operation_id_fk";--> statement-breakpoint

-- ── 9. Own-scope RLS: recreate the agenda policies on the renamed GUC + column ─
-- The 0005 policies keyed on `app.current_professional` + `professional_id`. Both
-- renamed, so the predicate must be rebuilt; otherwise `setRlsGucs` sets a GUC the
-- policy never reads and own-scope silently no-ops. #1265 wires the write path to
-- set this GUC; here the policy is realigned to read it.
DROP POLICY IF EXISTS "appointments_org_unit_isolation" ON "appointments";--> statement-breakpoint
CREATE POLICY "appointments_org_unit_isolation" ON "appointments"
  USING (
    "org_id" = current_setting('app.current_org', true)
    AND (
      "unit_id" IS NULL
      OR current_setting('app.current_unit', true) IS NULL
      OR current_setting('app.current_unit', true) = ''
      OR "unit_id" = current_setting('app.current_unit', true)
    )
    AND (
      current_setting('app.current_member_operation', true) IS NULL
      OR current_setting('app.current_member_operation', true) = ''
      OR "member_operation_id" = current_setting('app.current_member_operation', true)
    )
  )
  WITH CHECK (
    "org_id" = current_setting('app.current_org', true)
    AND (
      current_setting('app.current_member_operation', true) IS NULL
      OR current_setting('app.current_member_operation', true) = ''
      OR "member_operation_id" = current_setting('app.current_member_operation', true)
    )
  );--> statement-breakpoint
-- NOTE (brief 0075, #1264 review): the WITH CHECK below admits a NULL
-- `member_operation_id` (a whole-unit block) for ANY acting scope. This is safe
-- ONLY because block writes are manager-gated at the app layer
-- (`blocks.actions.ts` → `requireManagerCtx`), so a self-scoped member never
-- reaches the write path. If a future "member blocks their own time" feature lets
-- a non-manager write blocks, this clause must additionally forbid a self-scoped
-- member from authoring a NULL (unit-wide) block — the policy does NOT enforce
-- that today.
DROP POLICY IF EXISTS "agenda_blocks_org_unit_isolation" ON "agenda_blocks";--> statement-breakpoint
CREATE POLICY "agenda_blocks_org_unit_isolation" ON "agenda_blocks"
  USING (
    "org_id" = current_setting('app.current_org', true)
    AND (
      current_setting('app.current_unit', true) IS NULL
      OR current_setting('app.current_unit', true) = ''
      OR "unit_id" = current_setting('app.current_unit', true)
    )
    AND (
      current_setting('app.current_member_operation', true) IS NULL
      OR current_setting('app.current_member_operation', true) = ''
      OR "member_operation_id" IS NULL
      OR "member_operation_id" = current_setting('app.current_member_operation', true)
    )
  )
  WITH CHECK (
    "org_id" = current_setting('app.current_org', true)
    AND (
      current_setting('app.current_member_operation', true) IS NULL
      OR current_setting('app.current_member_operation', true) = ''
      OR "member_operation_id" IS NULL
      OR "member_operation_id" = current_setting('app.current_member_operation', true)
    )
  );--> statement-breakpoint

-- ── 10. RBAC role rename: data + CHECK on memberships and invites ─────────────
UPDATE "memberships" SET "role" = 'member_operator' WHERE "role" = 'professional';--> statement-breakpoint
UPDATE "invites" SET "role" = 'member_operator' WHERE "role" = 'professional';--> statement-breakpoint
ALTER TABLE "memberships" DROP CONSTRAINT "memberships_role_check";--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_role_check" CHECK ("memberships"."role" IN ('owner', 'manager', 'member_operator', 'receptionist'));--> statement-breakpoint
ALTER TABLE "invites" DROP CONSTRAINT "invites_role_check";--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_role_check" CHECK ("invites"."role" IN ('owner', 'manager', 'member_operator', 'receptionist'));--> statement-breakpoint

-- ── 11. Capability key rename in the membership permissions JSONB ─────────────
-- `canManageProfessionals` → `canManageOperators`. Rename the key, preserving its
-- boolean value, on every membership that carries it.
UPDATE "memberships"
  SET "permissions" = ("permissions" - 'canManageProfessionals')
    || jsonb_build_object('canManageOperators', "permissions"->'canManageProfessionals')
  WHERE "permissions" ? 'canManageProfessionals';--> statement-breakpoint

-- ── 12. Event log rewrite: aggregate_type + _tag + appointment payload field ──
-- The aggregate type literal and the event `_tag`s are persisted identifiers in
-- the immutable `events` table. The 0076 decision renames the resource itself, so
-- the historical stream is rewritten in lock-step (pre-prod, re-seedable). The
-- envelope is JSONB: rewrite the `_tag` and, for appointment events, the
-- `professionalId`/`professionalUserId` payload fields the domain schema renamed.
UPDATE "events" SET "aggregate_type" = 'member_operation' WHERE "aggregate_type" = 'professional';--> statement-breakpoint
UPDATE "events"
  SET "envelope" = jsonb_set("envelope", '{_tag}',
    to_jsonb('member_operation.' || split_part("envelope"->>'_tag', '.', 2)))
  WHERE "envelope"->>'_tag' LIKE 'professional.%';--> statement-breakpoint
-- Appointment payload references the performer by the renamed field. Rewrite the
-- key inside the event `data` blob for appointment.* events that carry it.
UPDATE "events"
  SET "envelope" = jsonb_set(
        "envelope",
        '{payload,data}',
        ("envelope"#>'{payload,data}')
          - 'professionalId' - 'professionalUserId'
          || jsonb_strip_nulls(jsonb_build_object(
               'memberOperationId', "envelope"#>'{payload,data,professionalId}',
               'memberOperatorUserId', "envelope"#>'{payload,data,professionalUserId}'))
      )
  WHERE "aggregate_type" = 'appointment'
    AND "envelope"#>'{payload,data}' ?| array['professionalId','professionalUserId'];
