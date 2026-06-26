-- Row-Level Security for the billing ES contexts (brief 0061, feature E, § Grupo
-- B — AC-03). Inherits the C/D/Grupo-A mechanism wholesale: org-only policies,
-- `org_id = current_setting('app.current_org', true)` (NULL when unset → zero
-- rows, fail-closed), `FORCE ROW LEVEL SECURITY` so the policy applies even to
-- the table owner. Charges and subscriptions are org-scoped (no per-unit
-- isolation — a subscription's unit is a field, not a scope).

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
  WITH CHECK ("org_id" = current_setting('app.current_org', true));
