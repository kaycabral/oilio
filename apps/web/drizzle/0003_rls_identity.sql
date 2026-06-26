-- Row-Level Security for the identity contexts (brief 0059, feature C, AC-02).
--
-- Isolation moves INTO the database: a session scoped to org A (via
-- `SET LOCAL app.current_org = 'A'` in `runTransaction`, brief 0059 Sub B) reads
-- and writes ONLY org-A rows — the substitution of the ~449-line Firestore
-- Security Rules at the DB level, as defense-in-depth alongside the app-layer
-- `requireOrgCtx` (RBAC) and the typed CHECK constraints (Sub A).
--
-- Policy shape:
--   • ORG predicate (every identity table): `org_id = current_setting(
--     'app.current_org', true)`. `current_setting(..., true)` returns NULL when
--     the GUC is unset → `org_id = NULL` is NULL (not true) → the session sees
--     ZERO rows. Fail-closed: a query with no org context is refused by the DB.
--   • UNIT predicate (units + memberships, which carry a unit scope): a row is
--     visible when it is org-wide (`unit_id IS NULL`), OR no unit is pinned for
--     the session (`app.current_unit` empty = org-wide membership), OR the row's
--     unit matches the session unit. A single-unit-locked session
--     (`app.current_unit = 'U1'`) cannot see another unit's row.
--
-- `FORCE ROW LEVEL SECURITY` makes the policies apply even to the table owner —
-- in production the runtime role is NOT the owner and has no `BYPASSRLS`, but
-- FORCE guarantees the isolation holds regardless (the ephemeral local/CI
-- Postgres connects as superuser, so FORCE is what makes the integration proof
-- meaningful there). The migration Job (DDL) uses a privileged role; the runtime
-- role does not — the separation is operational (provisioning), per ADR.
--
-- `catalog_items` (feature B) is brought under RLS retroactively (brief 0059 §
-- Riscos): a typed projection must not sit without DB isolation while the
-- Postgres flag exists. Its policy is org-only (catalog items are not unit-locked
-- at the row level — unit scoping is a JSONB `unit_ids` concern handled in the
-- app read path, not an RLS predicate).

-- ── orgs ────────────────────────────────────────────────────────────────────
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

-- ── memberships (org + unit predicate) ────────────────────────────────────────
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "memberships_org_unit_isolation" ON "memberships"
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

-- ── catalog_items (org-only, retroactive — feature B under RLS) ───────────────
ALTER TABLE "catalog_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "catalog_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "catalog_items_org_isolation" ON "catalog_items"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));
