-- Row-Level Security for the financial-core ES contexts (brief 0061, feature E,
-- § Grupo A — AC-03).
--
-- Inherits the C/D mechanism wholesale: a session scoped to org A (via
-- `SET LOCAL app.current_org = 'A'` in `runTransaction`/`readUnderRls`) reads and
-- writes ONLY org-A rows. Zero new isolation mechanism — the same org-only policy
-- shape as 0003_rls_identity / 0005_rls_config, applied to the 3 financial tables.
-- Defense-in-depth alongside the app-layer `requireOrgCtx` (RBAC) and the typed
-- CHECK constraints (AC-01).
--
-- All three are ORG-only here: `org_id = current_setting('app.current_org', true)`.
-- `current_setting(..., true)` returns NULL when the GUC is unset → the session
-- sees ZERO rows (fail-closed). `cash_movements` carries a `unit_id`, but cash is
-- org-wide reporting (no per-unit isolation requirement) — the unit-scoped RLS in
-- feature E is `appointment` (Grupo C), not the financial ledger. Orders and
-- commissions have no unit predicate (an order's unit is a field, not a scope).
--
-- `FORCE ROW LEVEL SECURITY` makes the policies apply even to the table owner — in
-- production the runtime role is NOT the owner and has no `BYPASSRLS`, but FORCE
-- guarantees the isolation holds regardless (the ephemeral local/CI Postgres
-- connects as superuser, so FORCE is what makes the integration proof meaningful).

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
  WITH CHECK ("org_id" = current_setting('app.current_org', true));
