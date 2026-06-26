-- Rename `memberships.unit_id` → `memberships.rls_unit_scope` (brief 0068 D4 /
-- #1226 AC-03). The column is the single-unit RLS lock of a membership; the old
-- name collided conceptually with `professionals.unit_ids[]` (a professional's
-- areas of operation). The domain field is renamed `unitId` → `rlsUnitScope` in
-- lock-step (the event WIRE payload contract is unchanged — legacy
-- `membership.created` events keep their `unitId` key and are normalized at the
-- event decode boundary, no upcaster).
--
-- The RLS unit policy reads this column directly, so it is dropped and recreated
-- against the new name (a policy predicate cannot follow a RENAME COLUMN). The
-- `app.current_unit` GUC is unchanged — only the column the policy reads is
-- renamed. Policy shape copied verbatim from 0003_rls_identity.sql (lines
-- 54-67), substituting `unit_id` → `rls_unit_scope`.

DROP POLICY "memberships_org_unit_isolation" ON "memberships";--> statement-breakpoint

ALTER TABLE "memberships" RENAME COLUMN "unit_id" TO "rls_unit_scope";--> statement-breakpoint
ALTER TABLE "memberships" RENAME CONSTRAINT "memberships_unit_id_fk" TO "memberships_rls_unit_scope_fk";--> statement-breakpoint

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
  WITH CHECK ("org_id" = current_setting('app.current_org', true));
