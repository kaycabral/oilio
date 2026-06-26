-- D3 (brief 0068): professional ↔ unit / service N:N arrays → join tables. These
-- are DERIVED projections of the `professional` aggregate (the `unit_ids` /
-- `catalog_service_ids` arrays stay in the reduced state; the projector mirrors
-- them here in the same tx). No version/aggregate_path of their own. Org-scoped
-- under RLS (org-only, like `professionals`); composite FKs follow the D2 pattern
-- (CASCADE to the parent professional, RESTRICT to the unit/service target).
-- drizzle-kit emits the tables/FKs/indexes; the RLS policies are authored by hand
-- below (drizzle does not generate RLS) — mirroring 0005_rls_config.sql.
CREATE TABLE "professional_services" (
	"org_id" text NOT NULL,
	"professional_id" text NOT NULL,
	"service_id" text NOT NULL,
	CONSTRAINT "professional_services_org_id_professional_id_service_id_pk" PRIMARY KEY("org_id","professional_id","service_id")
);
--> statement-breakpoint
CREATE TABLE "professional_units" (
	"org_id" text NOT NULL,
	"professional_id" text NOT NULL,
	"unit_id" text NOT NULL,
	CONSTRAINT "professional_units_org_id_professional_id_unit_id_pk" PRIMARY KEY("org_id","professional_id","unit_id")
);
--> statement-breakpoint
ALTER TABLE "professional_services" ADD CONSTRAINT "professional_services_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_services" ADD CONSTRAINT "professional_services_professional_id_fk" FOREIGN KEY ("org_id","professional_id") REFERENCES "public"."professionals"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_services" ADD CONSTRAINT "professional_services_service_id_fk" FOREIGN KEY ("org_id","service_id") REFERENCES "public"."catalog_items"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_units" ADD CONSTRAINT "professional_units_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_units" ADD CONSTRAINT "professional_units_professional_id_fk" FOREIGN KEY ("org_id","professional_id") REFERENCES "public"."professionals"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_units" ADD CONSTRAINT "professional_units_unit_id_fk" FOREIGN KEY ("org_id","unit_id") REFERENCES "public"."units"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "professional_services_org_id_service_id_idx" ON "professional_services" USING btree ("org_id","service_id");--> statement-breakpoint
CREATE INDEX "professional_units_org_id_unit_id_idx" ON "professional_units" USING btree ("org_id","unit_id");--> statement-breakpoint

-- ── RLS (org-only) — mirror professionals/customers in 0005_rls_config.sql ─────
ALTER TABLE "professional_units" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "professional_units" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "professional_units_org_isolation" ON "professional_units"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));--> statement-breakpoint
ALTER TABLE "professional_services" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "professional_services" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "professional_services_org_isolation" ON "professional_services"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));