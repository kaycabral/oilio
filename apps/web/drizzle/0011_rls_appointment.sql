-- Row-Level Security for the `appointment` ES context (brief 0061, feature E, §
-- Grupo C — AC-02). UNIT-scoped: inherits the org+unit predicate from feature C
-- (`units`/`memberships` in 0003_rls_identity) so a session pinned to a unit
-- sees only that unit's agenda, while an org-wide session (empty
-- `app.current_unit`) sees all units of the org. `appointment.unit_id` is NOT
-- NULL, so the `unit_id IS NULL` branch never fires here — kept for shape parity
-- with the identity policies. `FORCE ROW LEVEL SECURITY` applies the policy even
-- to the table owner (the ephemeral local/CI Postgres connects as superuser).

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
  WITH CHECK ("org_id" = current_setting('app.current_org', true));
