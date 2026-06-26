-- D3 (brief 0068): subscription-plan ↔ item/category/unit-allowlist and
-- catalog-item ↔ unit N:N arrays → join tables. These are DERIVED projections of
-- their aggregates (the `included_item_ids` / `included_category_ids` /
-- `unit_allowlist` / `unit_ids` arrays stay in the reduced state; the projectors
-- mirror them here in the same tx). No version/aggregate_path of their own.
-- Org-scoped under RLS (org-only, like their parents); composite FKs follow the
-- D2 pattern (CASCADE to the parent plan/item, RESTRICT to the
-- unit/item/category target). `plan_unit_allowlist` is only populated when a plan
-- HAS an allowlist — a NULL/absent allowlist means "no restriction" → zero rows.
-- drizzle-kit emits the tables/FKs/indexes; the RLS policies are authored by hand
-- below (drizzle does not generate RLS) — mirroring 0017_flawless_famine.sql.
CREATE TABLE "catalog_item_units" (
	"org_id" text NOT NULL,
	"catalog_item_id" text NOT NULL,
	"unit_id" text NOT NULL,
	CONSTRAINT "catalog_item_units_org_id_catalog_item_id_unit_id_pk" PRIMARY KEY("org_id","catalog_item_id","unit_id")
);
--> statement-breakpoint
CREATE TABLE "plan_included_categories" (
	"org_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"category_id" text NOT NULL,
	CONSTRAINT "plan_included_categories_org_id_plan_id_category_id_pk" PRIMARY KEY("org_id","plan_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "plan_included_items" (
	"org_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"item_id" text NOT NULL,
	CONSTRAINT "plan_included_items_org_id_plan_id_item_id_pk" PRIMARY KEY("org_id","plan_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "plan_unit_allowlist" (
	"org_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"unit_id" text NOT NULL,
	CONSTRAINT "plan_unit_allowlist_org_id_plan_id_unit_id_pk" PRIMARY KEY("org_id","plan_id","unit_id")
);
--> statement-breakpoint
ALTER TABLE "catalog_item_units" ADD CONSTRAINT "catalog_item_units_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_item_units" ADD CONSTRAINT "catalog_item_units_catalog_item_id_fk" FOREIGN KEY ("org_id","catalog_item_id") REFERENCES "public"."catalog_items"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_item_units" ADD CONSTRAINT "catalog_item_units_unit_id_fk" FOREIGN KEY ("org_id","unit_id") REFERENCES "public"."units"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_included_categories" ADD CONSTRAINT "plan_included_categories_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_included_categories" ADD CONSTRAINT "plan_included_categories_plan_id_fk" FOREIGN KEY ("org_id","plan_id") REFERENCES "public"."subscription_plans"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_included_categories" ADD CONSTRAINT "plan_included_categories_category_id_fk" FOREIGN KEY ("org_id","category_id") REFERENCES "public"."categories"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_included_items" ADD CONSTRAINT "plan_included_items_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_included_items" ADD CONSTRAINT "plan_included_items_plan_id_fk" FOREIGN KEY ("org_id","plan_id") REFERENCES "public"."subscription_plans"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_included_items" ADD CONSTRAINT "plan_included_items_item_id_fk" FOREIGN KEY ("org_id","item_id") REFERENCES "public"."catalog_items"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_unit_allowlist" ADD CONSTRAINT "plan_unit_allowlist_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_unit_allowlist" ADD CONSTRAINT "plan_unit_allowlist_plan_id_fk" FOREIGN KEY ("org_id","plan_id") REFERENCES "public"."subscription_plans"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_unit_allowlist" ADD CONSTRAINT "plan_unit_allowlist_unit_id_fk" FOREIGN KEY ("org_id","unit_id") REFERENCES "public"."units"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_item_units_org_id_unit_id_idx" ON "catalog_item_units" USING btree ("org_id","unit_id");--> statement-breakpoint
CREATE INDEX "plan_included_categories_org_id_category_id_idx" ON "plan_included_categories" USING btree ("org_id","category_id");--> statement-breakpoint
CREATE INDEX "plan_included_items_org_id_item_id_idx" ON "plan_included_items" USING btree ("org_id","item_id");--> statement-breakpoint
CREATE INDEX "plan_unit_allowlist_org_id_unit_id_idx" ON "plan_unit_allowlist" USING btree ("org_id","unit_id");--> statement-breakpoint

-- ── RLS (org-only) — mirror professionals/customers in 0005_rls_config.sql ─────
ALTER TABLE "catalog_item_units" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "catalog_item_units" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "catalog_item_units_org_isolation" ON "catalog_item_units"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));--> statement-breakpoint
ALTER TABLE "plan_included_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "plan_included_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "plan_included_items_org_isolation" ON "plan_included_items"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));--> statement-breakpoint
ALTER TABLE "plan_included_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "plan_included_categories" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "plan_included_categories_org_isolation" ON "plan_included_categories"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));--> statement-breakpoint
ALTER TABLE "plan_unit_allowlist" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "plan_unit_allowlist" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "plan_unit_allowlist_org_isolation" ON "plan_unit_allowlist"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));