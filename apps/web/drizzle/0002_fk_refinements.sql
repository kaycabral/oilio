-- ════════════════════════════════════════════════════════════════════════════
-- Cross-aggregate FK refinements drizzle-kit cannot express (D6 / ADR 0013).
--
-- The squashed structural migration (0000) emits every FK from the Drizzle
-- schema, but drizzle-kit 0.45 cannot express two refinements the saga/replay
-- model requires — so it emits the closest approximation (plain `SET NULL`,
-- non-deferrable) and these are corrected here by DROP + re-ADD. This file is the
-- D6 successor of the pre-squash hand-written 0016 (`fluffy_runaways`).
--
--   1. COMPOSITE SET-NULL must use the column-list form `ON DELETE SET NULL
--      (ref_col)` (Postgres 15+). A bare `SET NULL` on a composite
--      (org_id, ref_id) FK nulls ALL its columns — including the NOT NULL
--      `org_id` — so a parent delete raises 23502 instead of nulling just the
--      ref. (Proven by `fk-restrict` + the offboarding/erasure cascades.)
--   2. DEFERRABLE INITIALLY DEFERRED: the close-order / create-subscription /
--      charge sagas append the CHILD aggregate before the PARENT within one tx
--      (replay reconstructs in the same order), so the FK must be checked at
--      COMMIT, not per-statement. (Proven by the *-saga-acid suites.)
--
-- The schema keeps `.onDelete('set null')` / `.references(...)` as the closest
-- expressible intent; the precise form lives here.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Composite SET-NULL FKs → column-list form (null only the ref column) ───────
ALTER TABLE "agenda_blocks" DROP CONSTRAINT "agenda_blocks_professional_id_fk";--> statement-breakpoint
ALTER TABLE "agenda_blocks" ADD CONSTRAINT "agenda_blocks_professional_id_fk" FOREIGN KEY ("org_id","professional_id") REFERENCES "public"."professionals"("org_id","id") ON DELETE SET NULL ("professional_id") ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "catalog_items" DROP CONSTRAINT "catalog_items_category_id_fk";--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_category_id_fk" FOREIGN KEY ("org_id","category_id") REFERENCES "public"."categories"("org_id","id") ON DELETE SET NULL ("category_id") ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "memberships" DROP CONSTRAINT "memberships_rls_unit_scope_fk";--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_rls_unit_scope_fk" FOREIGN KEY ("org_id","rls_unit_scope") REFERENCES "public"."units"("org_id","id") ON DELETE SET NULL ("rls_unit_scope") ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "orders" DROP CONSTRAINT "orders_appointment_id_fk";--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_appointment_id_fk" FOREIGN KEY ("org_id","appointment_id") REFERENCES "public"."appointments"("org_id","id") ON DELETE SET NULL ("appointment_id") ON UPDATE no action;--> statement-breakpoint

-- ── DEFERRABLE INITIALLY DEFERRED: child appended before parent in the saga tx ─
ALTER TABLE "charges" DROP CONSTRAINT "charges_subscription_id_fk";--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_subscription_id_fk" FOREIGN KEY ("org_id","subscription_id") REFERENCES "public"."subscriptions"("org_id","id") ON DELETE restrict ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint

ALTER TABLE "commissions" DROP CONSTRAINT "commissions_order_id_fk";--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_order_id_fk" FOREIGN KEY ("org_id","order_id") REFERENCES "public"."orders"("org_id","id") ON DELETE restrict ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint

-- cash_movements_order_id_fk is BOTH composite SET-NULL (column-list) AND deferred.
ALTER TABLE "cash_movements" DROP CONSTRAINT "cash_movements_order_id_fk";--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_order_id_fk" FOREIGN KEY ("org_id","order_id") REFERENCES "public"."orders"("org_id","id") ON DELETE SET NULL ("order_id") ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;
