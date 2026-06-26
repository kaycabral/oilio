-- D2 (brief 0068): foreign keys on cross-aggregate refs. Composite FKs
-- (org_id, ref_id) -> target(org_id, id) because every projection's PK is
-- `aggregate_path`, not `id`. UNIQUE(org_id, id) on each target FIRST (a
-- composite FK requires a matching unique key), then the FKs. Three FKs are
-- DEFERRABLE INITIALLY DEFERRED: the close-order / create-subscription sagas
-- append the child aggregate before the parent within one tx, so the FK must be
-- checked at COMMIT, not per-statement (replay reconstructs in the same order).
-- Composite SET-NULL FKs use the column-list form `ON DELETE SET NULL (ref_col)`
-- (Postgres 15+): a bare `SET NULL` on a composite FK nulls ALL its columns,
-- which would null the NOT-NULL `org_id` and raise 23502 on a parent delete. The
-- list restricts the null to the dangling ref column only (the child's org never
-- changes). drizzle-orm 0.45 can't express the column-list form, so these FKs are
-- authored here and the schema keeps `.onDelete('set null')` as the closest
-- approximation (a comment there points back to this rationale).
-- Snapshot/identity refs (commissions.attributed_user_id,
-- subscriptions.customer_user_id, appointments.professional_user_id) and refs to
-- the global `users` table are intentionally NOT FKs (LGPD retention + org/global
-- isolation, ADR 0010 D2).

-- ── UNIQUE(org_id, id) on FK targets (must exist before the composite FKs) ────
ALTER TABLE "units" ADD CONSTRAINT "units_org_id_id_uq" UNIQUE("org_id","id");--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_org_id_id_uq" UNIQUE("org_id","id");--> statement-breakpoint
ALTER TABLE "professionals" ADD CONSTRAINT "professionals_org_id_id_uq" UNIQUE("org_id","id");--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_org_id_id_uq" UNIQUE("org_id","id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_org_id_id_uq" UNIQUE("org_id","id");--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_org_id_id_uq" UNIQUE("org_id","id");--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_org_id_id_uq" UNIQUE("org_id","id");--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_org_id_id_uq" UNIQUE("org_id","id");--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD CONSTRAINT "subscription_plans_org_id_id_uq" UNIQUE("org_id","id");--> statement-breakpoint

-- ── org_id -> orgs.org_id (single col, CASCADE) — faltantes ──────────────────
ALTER TABLE "orders" ADD CONSTRAINT "orders_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- ── Composite cross-aggregate FKs (non-deferrable) ──────────────────────────
ALTER TABLE "orders" ADD CONSTRAINT "orders_unit_id_fk" FOREIGN KEY ("org_id","unit_id") REFERENCES "public"."units"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fk" FOREIGN KEY ("org_id","customer_id") REFERENCES "public"."customers"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_appointment_id_fk" FOREIGN KEY ("org_id","appointment_id") REFERENCES "public"."appointments"("org_id","id") ON DELETE SET NULL ("appointment_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_customer_id_fk" FOREIGN KEY ("org_id","customer_id") REFERENCES "public"."customers"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_unit_id_fk" FOREIGN KEY ("org_id","unit_id") REFERENCES "public"."units"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_customer_id_fk" FOREIGN KEY ("org_id","customer_id") REFERENCES "public"."customers"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_category_id_fk" FOREIGN KEY ("org_id","category_id") REFERENCES "public"."categories"("org_id","id") ON DELETE SET NULL ("category_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_unit_id_fk" FOREIGN KEY ("org_id","unit_id") REFERENCES "public"."units"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_professional_id_fk" FOREIGN KEY ("org_id","professional_id") REFERENCES "public"."professionals"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_customer_id_fk" FOREIGN KEY ("org_id","customer_id") REFERENCES "public"."customers"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_service_id_fk" FOREIGN KEY ("org_id","service_id") REFERENCES "public"."catalog_items"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_unit_id_fk" FOREIGN KEY ("org_id","unit_id") REFERENCES "public"."units"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agenda_blocks" ADD CONSTRAINT "agenda_blocks_unit_id_fk" FOREIGN KEY ("org_id","unit_id") REFERENCES "public"."units"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agenda_blocks" ADD CONSTRAINT "agenda_blocks_professional_id_fk" FOREIGN KEY ("org_id","professional_id") REFERENCES "public"."professionals"("org_id","id") ON DELETE SET NULL ("professional_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_unit_id_fk" FOREIGN KEY ("org_id","unit_id") REFERENCES "public"."units"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_unit_id_fk" FOREIGN KEY ("org_id","unit_id") REFERENCES "public"."units"("org_id","id") ON DELETE SET NULL ("unit_id") ON UPDATE no action;--> statement-breakpoint

-- ── DEFERRABLE INITIALLY DEFERRED: child appended before parent in the saga/replay tx ──
ALTER TABLE "charges" ADD CONSTRAINT "charges_subscription_id_fk" FOREIGN KEY ("org_id","subscription_id") REFERENCES "public"."subscriptions"("org_id","id") ON DELETE restrict ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_order_id_fk" FOREIGN KEY ("org_id","order_id") REFERENCES "public"."orders"("org_id","id") ON DELETE restrict ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_order_id_fk" FOREIGN KEY ("org_id","order_id") REFERENCES "public"."orders"("org_id","id") ON DELETE SET NULL ("order_id") ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;
