-- ════════════════════════════════════════════════════════════════════════════
-- Row-Level Security + the appointment anti-double-book exclusion constraint.
--
-- D6 (ADR 0013): the migration chain was squashed to a single structural
-- migration (`0000`) that nasce já com PK(org_id, id) — prod era descartável, so
-- the Firestore-legacy `aggregate_path` PK and the redundant compensating
-- `UNIQUE(org_id, id)` constraints (only needed while the PK was the path) are
-- gone. drizzle-kit emits the tables / columns / FKs / CHECKs / indexes from the
-- schema; it does NOT emit RLS policies or the GiST exclusion constraint — those
-- are authored here, consolidated from the pre-squash hand-written migrations
-- (0003/0005/0007/0009/0011/0012/0013/0017/0018/0019) into their FINAL state.
--
-- Policy mechanism (unchanged by D6 — every policy keys on `org_id` /
-- `app.current_*`, never on the dropped `aggregate_path`):
--   • ORG predicate: `org_id = current_setting('app.current_org', true)`.
--     `current_setting(..., true)` returns NULL when the GUC is unset → the row
--     predicate is NULL (not true) → the session sees ZERO rows. Fail-closed.
--   • ORG + UNIT predicate (units, memberships, agenda_blocks, goals,
--     notifications, appointments): visible when org matches AND (the row is
--     org-wide / no unit pinned for the session / the row's unit matches the
--     session unit).
--   • PER-SUBJECT predicate (org_links + the additional memberships SELECT):
--     `user_id = current_setting('app.current_user_id', true)` — reads that
--     precede any org context ("which orgs am I in?").
--   • PUBLIC-by-contract / global (public_org_directory, users, pii_events,
--     product_events): NO RLS by design.
--
-- `FORCE ROW LEVEL SECURITY` applies the policy even to the table owner — prod
-- runs as a non-owner role without BYPASSRLS, but the ephemeral local/CI Postgres
-- connects as superuser, so FORCE is what makes the integration proof meaningful.
-- ════════════════════════════════════════════════════════════════════════════

-- ── orgs (org-only) ───────────────────────────────────────────────────────────
ALTER TABLE "orgs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orgs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "orgs_org_isolation" ON "orgs"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));--> statement-breakpoint

-- ── units (org + unit predicate) ──────────────────────────────────────────────
ALTER TABLE "units" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "units" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "units_org_unit_isolation" ON "units"
  USING (
    "org_id" = current_setting('app.current_org', true)
    AND (
      current_setting('app.current_unit', true) IS NULL
      OR current_setting('app.current_unit', true) = ''
      OR "id" = current_setting('app.current_unit', true)
    )
  )
  WITH CHECK ("org_id" = current_setting('app.current_org', true));--> statement-breakpoint

-- ── memberships (org + unit predicate; final form keys on rls_unit_scope) ──────
-- The single-unit RLS lock column was renamed `unit_id` → `rls_unit_scope`
-- (brief 0068 D4 / #1226 AC-03) to disambiguate from `professionals.unit_ids[]`.
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "memberships_org_unit_isolation" ON "memberships"
  USING (
    "org_id" = current_setting('app.current_org', true)
    AND (
      "rls_unit_scope" IS NULL
      OR current_setting('app.current_unit', true) IS NULL
      OR current_setting('app.current_unit', true) = ''
      OR "rls_unit_scope" = current_setting('app.current_unit', true)
    )
  )
  WITH CHECK ("org_id" = current_setting('app.current_org', true));--> statement-breakpoint

-- ── memberships (ADDITIONAL per-subject SELECT) ────────────────────────────────
-- Lets the "which orgs am I a member of?" read (login / org switcher) succeed
-- with NO active org — the subject sees their own membership rows. PERMISSIVE
-- policies OR together, so operational org reads keep working AND a subject can
-- list their own memberships.
CREATE POLICY "memberships_subject_select" ON "memberships"
  FOR SELECT
  USING ("user_id" = current_setting('app.current_user_id', true));--> statement-breakpoint

-- ── catalog_items (org-only) ──────────────────────────────────────────────────
ALTER TABLE "catalog_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "catalog_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "catalog_items_org_isolation" ON "catalog_items"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));--> statement-breakpoint

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
  WITH CHECK ("org_id" = current_setting('app.current_org', true));--> statement-breakpoint

-- ── orders (org-only) ─────────────────────────────────────────────────────────
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "orders_org_isolation" ON "orders"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));--> statement-breakpoint

-- ── commissions (org-only) ────────────────────────────────────────────────────
ALTER TABLE "commissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commissions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "commissions_org_isolation" ON "commissions"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));--> statement-breakpoint

-- ── cash_movements (org-only) ─────────────────────────────────────────────────
ALTER TABLE "cash_movements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cash_movements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "cash_movements_org_isolation" ON "cash_movements"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));--> statement-breakpoint

-- ── charges (org-only) ────────────────────────────────────────────────────────
ALTER TABLE "charges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "charges" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "charges_org_isolation" ON "charges"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));--> statement-breakpoint

-- ── subscriptions (org-only) ──────────────────────────────────────────────────
ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "subscriptions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "subscriptions_org_isolation" ON "subscriptions"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));--> statement-breakpoint

-- ── appointments (org + unit predicate) ───────────────────────────────────────
-- `appointment.unit_id` is NOT NULL, so the `unit_id IS NULL` branch never fires
-- — kept for shape parity with the identity policies.
ALTER TABLE "appointments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "appointments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "appointments_org_unit_isolation" ON "appointments"
  USING (
    "org_id" = current_setting('app.current_org', true)
    AND (
      "unit_id" IS NULL
      OR current_setting('app.current_unit', true) IS NULL
      OR current_setting('app.current_unit', true) = ''
      OR "unit_id" = current_setting('app.current_unit', true)
    )
  )
  WITH CHECK ("org_id" = current_setting('app.current_org', true));--> statement-breakpoint

-- ── professional_units (org-only join projection) ─────────────────────────────
ALTER TABLE "professional_units" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "professional_units" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "professional_units_org_isolation" ON "professional_units"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));--> statement-breakpoint

-- ── professional_services (org-only join projection) ──────────────────────────
ALTER TABLE "professional_services" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "professional_services" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "professional_services_org_isolation" ON "professional_services"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));--> statement-breakpoint

-- ── catalog_item_units (org-only join projection) ─────────────────────────────
ALTER TABLE "catalog_item_units" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "catalog_item_units" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "catalog_item_units_org_isolation" ON "catalog_item_units"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));--> statement-breakpoint

-- ── plan_included_items (org-only join projection) ────────────────────────────
ALTER TABLE "plan_included_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "plan_included_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "plan_included_items_org_isolation" ON "plan_included_items"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));--> statement-breakpoint

-- ── plan_included_categories (org-only join projection) ───────────────────────
ALTER TABLE "plan_included_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "plan_included_categories" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "plan_included_categories_org_isolation" ON "plan_included_categories"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));--> statement-breakpoint

-- ── plan_unit_allowlist (org-only join projection) ────────────────────────────
ALTER TABLE "plan_unit_allowlist" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "plan_unit_allowlist" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "plan_unit_allowlist_org_isolation" ON "plan_unit_allowlist"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));--> statement-breakpoint

-- ── message_templates (org-only) ──────────────────────────────────────────────
ALTER TABLE "message_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "message_templates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "message_templates_org_isolation" ON "message_templates"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));--> statement-breakpoint

-- ── invites_pii (org-only PII sidecar) ────────────────────────────────────────
ALTER TABLE "invites_pii" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invites_pii" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "invites_pii_org_isolation" ON "invites_pii"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));--> statement-breakpoint

-- ── professionals_pii (org-only PII sidecar) ──────────────────────────────────
ALTER TABLE "professionals_pii" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "professionals_pii" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "professionals_pii_org_isolation" ON "professionals_pii"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));--> statement-breakpoint

-- ── units_pii (org-only PII sidecar) ──────────────────────────────────────────
ALTER TABLE "units_pii" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "units_pii" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "units_pii_org_isolation" ON "units_pii"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));--> statement-breakpoint

-- ── unit_tax_identity (org-only fiscal-PII sidecar) ───────────────────────────
ALTER TABLE "unit_tax_identity" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "unit_tax_identity" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "unit_tax_identity_org_isolation" ON "unit_tax_identity"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));--> statement-breakpoint

-- ── org_links (per-subject) ───────────────────────────────────────────────────
-- The identity reverse index: a subject reads ONLY their own links ("where am I
-- a customer?"). Server-only writes also scope to the subject.
ALTER TABLE "org_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "org_links" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_links_subject_isolation" ON "org_links"
  USING ("user_id" = current_setting('app.current_user_id', true))
  WITH CHECK ("user_id" = current_setting('app.current_user_id', true));--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════
-- Anti-double-book exclusion constraint (brief 0061 § Grupo C / #843).
--
-- No two `scheduled` appointments for the SAME org + professional may have
-- overlapping [start_at, end_at) intervals. `btree_gist` lets the equality
-- columns (org_id / professional_id) share a GiST index with the range-overlap
-- operator. The half-open `[)` range matches the domain `intervalsOverlap`
-- (a.start < b.end && b.start < a.end). A violating INSERT raises 23P01
-- (exclusion_violation) and the booking tx rolls back → `slot_taken`.
-- ════════════════════════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_no_double_book"
  EXCLUDE USING gist (
    "org_id" WITH =,
    "professional_id" WITH =,
    tstzrange("start_at", "end_at", '[)') WITH &&
  ) WHERE ("status" = 'scheduled');
