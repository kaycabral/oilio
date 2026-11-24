-- Professional own-scope RLS (brief 0075, #1256).
--
-- Adds an `app.current_professional` predicate to the agenda tables, mirroring
-- the existing `app.current_unit` shape: PERMISSIVE when the GUC is unset/empty
-- (the balcão — owner/manager/recepção read/write everything), RESTRICTIVE to
-- the acting professional's own rows when set. The app role has no BYPASSRLS, so
-- a self-scoped professional cannot read or write a colleague's appointment or
-- block — the database refuses it. Set the GUC only for a professional's session
-- (resolved in `getActiveOrgContext`); leave it empty for the balcão.
--
-- `agenda_blocks.professional_id` is NULLABLE (a NULL block is unit-wide, owned
-- by no one) — those stay visible to everyone, so the predicate admits NULL.
-- `appointments.professional_id` is NOT NULL.
--
-- Orders are intentionally NOT scoped here: an order has no `professional_id`
-- column (ownership is per-item via `OrderItem.attributedUserId`, and an order
-- can span multiple professionals), so the professional's "own sales" view is
-- filtered at the read layer, not by RLS. See brief 0075 § Riscos.

-- ── appointments: org + unit + professional own-scope ─────────────────────────
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
      current_setting('app.current_professional', true) IS NULL
      OR current_setting('app.current_professional', true) = ''
      OR "professional_id" = current_setting('app.current_professional', true)
    )
  )
  WITH CHECK (
    "org_id" = current_setting('app.current_org', true)
    AND (
      current_setting('app.current_professional', true) IS NULL
      OR current_setting('app.current_professional', true) = ''
      OR "professional_id" = current_setting('app.current_professional', true)
    )
  );--> statement-breakpoint

-- ── agenda_blocks: org + unit + professional own-scope (NULL = unit-wide) ──────
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
      current_setting('app.current_professional', true) IS NULL
      OR current_setting('app.current_professional', true) = ''
      OR "professional_id" IS NULL
      OR "professional_id" = current_setting('app.current_professional', true)
    )
  )
  WITH CHECK (
    "org_id" = current_setting('app.current_org', true)
    AND (
      current_setting('app.current_professional', true) IS NULL
      OR current_setting('app.current_professional', true) = ''
      OR "professional_id" IS NULL
      OR "professional_id" = current_setting('app.current_professional', true)
    )
  );
