-- Row-Level Security for the config contexts (brief 0060, feature D, AC-02).
--
-- Inherits the C mechanism wholesale: a session scoped to org A (via
-- `SET LOCAL app.current_org = 'A'` in `runTransaction`/`readUnderRls`) reads and
-- writes ONLY org-A rows. Zero new isolation mechanism — the same policy shape as
-- 0003_rls_identity, applied to the 8 new typed tables. Defense-in-depth alongside
-- the app-layer `requireOrgCtx` (RBAC) and the typed CHECK constraints (AC-01).
--
-- Policy shapes (same as 0003):
--   • ORG-only (professionals, customers, invites, categories, subscription_plans):
--     `org_id = current_setting('app.current_org', true)`. `current_setting(..., true)`
--     returns NULL when the GUC is unset → the session sees ZERO rows (fail-closed).
--   • ORG + UNIT (agenda_blocks, goals, notifications — they carry a `unit_id`):
--     a row is visible when org matches AND (no unit is pinned for the session —
--     `app.current_unit` empty = org-wide — OR the row's `unit_id` matches the
--     session unit). A single-unit-locked session cannot see another unit's row.
--     The WITH CHECK is org-only (a write is scoped by org; the unit predicate is a
--     read-visibility concern, mirroring `units`/`memberships` in 0003).
--
-- `FORCE ROW LEVEL SECURITY` makes the policies apply even to the table owner — in
-- production the runtime role is NOT the owner and has no `BYPASSRLS`, but FORCE
-- guarantees the isolation holds regardless (the ephemeral local/CI Postgres
-- connects as superuser, so FORCE is what makes the integration proof meaningful).

-- ── professionals (org-only) ──────────────────────────────────────────────────
ALTER TABLE "professionals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "professionals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "professionals_org_isolation" ON "professionals"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));--> statement-breakpoint

-- ── customers (org-only) ──────────────────────────────────────────────────────
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "customers_org_isolation" ON "customers"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));--> statement-breakpoint

-- ── invites (org-only) ────────────────────────────────────────────────────────
ALTER TABLE "invites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invites" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "invites_org_isolation" ON "invites"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));--> statement-breakpoint

-- ── categories (org-only) ─────────────────────────────────────────────────────
ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "categories" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "categories_org_isolation" ON "categories"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));--> statement-breakpoint

-- ── subscription_plans (org-only) ─────────────────────────────────────────────
ALTER TABLE "subscription_plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "subscription_plans" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "subscription_plans_org_isolation" ON "subscription_plans"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));--> statement-breakpoint

-- ── agenda_blocks (org + unit predicate) ──────────────────────────────────────
ALTER TABLE "agenda_blocks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agenda_blocks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "agenda_blocks_org_unit_isolation" ON "agenda_blocks"
  USING (
    "org_id" = current_setting('app.current_org', true)
    AND (
      current_setting('app.current_unit', true) IS NULL
      OR current_setting('app.current_unit', true) = ''
      OR "unit_id" = current_setting('app.current_unit', true)
    )
  )
  WITH CHECK ("org_id" = current_setting('app.current_org', true));--> statement-breakpoint

-- ── goals (org + unit predicate) ──────────────────────────────────────────────
ALTER TABLE "goals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "goals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "goals_org_unit_isolation" ON "goals"
  USING (
    "org_id" = current_setting('app.current_org', true)
    AND (
      current_setting('app.current_unit', true) IS NULL
      OR current_setting('app.current_unit', true) = ''
      OR "unit_id" = current_setting('app.current_unit', true)
    )
  )
  WITH CHECK ("org_id" = current_setting('app.current_org', true));--> statement-breakpoint

-- ── notifications (org + unit predicate) ──────────────────────────────────────
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "notifications_org_unit_isolation" ON "notifications"
  USING (
    "org_id" = current_setting('app.current_org', true)
    AND (
      current_setting('app.current_unit', true) IS NULL
      OR current_setting('app.current_unit', true) = ''
      OR "unit_id" = current_setting('app.current_unit', true)
    )
  )
  WITH CHECK ("org_id" = current_setting('app.current_org', true));
