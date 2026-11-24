CREATE TABLE "fixed_cost_overrides" (
	"org_id" text NOT NULL,
	"id" text NOT NULL,
	"unit_id" text NOT NULL,
	"series_id" text NOT NULL,
	"last_event_version" bigint NOT NULL,
	"month" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "fixed_cost_overrides_pkey" PRIMARY KEY("org_id","id"),
	CONSTRAINT "fixed_cost_overrides_amount_cents_positive" CHECK ("fixed_cost_overrides"."amount_cents" >= 1),
	CONSTRAINT "fixed_cost_overrides_unit_id_nonempty" CHECK (char_length(btrim("fixed_cost_overrides"."unit_id")) > 0),
	CONSTRAINT "fixed_cost_overrides_series_id_nonempty" CHECK (char_length(btrim("fixed_cost_overrides"."series_id")) > 0),
	CONSTRAINT "fixed_cost_overrides_month_shape" CHECK ("fixed_cost_overrides"."month" ~ '^[0-9]{4}-[0-9]{2}$')
);
--> statement-breakpoint
CREATE TABLE "fixed_costs" (
	"org_id" text NOT NULL,
	"id" text NOT NULL,
	"unit_id" text NOT NULL,
	"series_id" text NOT NULL,
	"last_event_version" bigint NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "fixed_costs_pkey" PRIMARY KEY("org_id","id"),
	CONSTRAINT "fixed_costs_amount_cents_positive" CHECK ("fixed_costs"."amount_cents" >= 1),
	CONSTRAINT "fixed_costs_name_nonempty" CHECK (char_length(btrim("fixed_costs"."name")) > 0),
	CONSTRAINT "fixed_costs_category_check" CHECK ("fixed_costs"."category" IN ('expense_commercial', 'expense_admin', 'expense_financial')),
	CONSTRAINT "fixed_costs_unit_id_nonempty" CHECK (char_length(btrim("fixed_costs"."unit_id")) > 0),
	CONSTRAINT "fixed_costs_series_id_nonempty" CHECK (char_length(btrim("fixed_costs"."series_id")) > 0),
	CONSTRAINT "fixed_costs_vigencia_coherent" CHECK ("fixed_costs"."effective_to" IS NULL OR "fixed_costs"."effective_from" < "fixed_costs"."effective_to")
);
--> statement-breakpoint
ALTER TABLE "fixed_cost_overrides" ADD CONSTRAINT "fixed_cost_overrides_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_cost_overrides" ADD CONSTRAINT "fixed_cost_overrides_unit_id_fk" FOREIGN KEY ("org_id","unit_id") REFERENCES "public"."units"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_costs" ADD CONSTRAINT "fixed_costs_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_costs" ADD CONSTRAINT "fixed_costs_unit_id_fk" FOREIGN KEY ("org_id","unit_id") REFERENCES "public"."units"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fixed_cost_overrides_org_series_month_uq" ON "fixed_cost_overrides" USING btree ("org_id","series_id","month");--> statement-breakpoint
CREATE INDEX "fixed_cost_overrides_org_id_unit_id_idx" ON "fixed_cost_overrides" USING btree ("org_id","unit_id");--> statement-breakpoint
CREATE INDEX "fixed_costs_org_id_unit_id_idx" ON "fixed_costs" USING btree ("org_id","unit_id");--> statement-breakpoint
CREATE INDEX "fixed_costs_org_id_series_id_idx" ON "fixed_costs" USING btree ("org_id","series_id");--> statement-breakpoint
-- ── Row-Level Security (brief 0092, Feature B) ────────────────────────────────
-- drizzle-kit does NOT emit RLS policies; they are hand-written here (same as the
-- 0001 baseline). Both tables are org + unit scoped (a fixed cost is always
-- per-unit): the policy confines every read/write to the current org, and to the
-- current unit when `app.current_unit` is set (org-wide when it is NULL/''). The
-- app role has no BYPASSRLS, so the cross-scope refusal comes from the DB
-- (proven by integration). `FORCE` applies the policy even to the table owner
-- (the CI Postgres connects as superuser). New tables, zero rows → no self-heal.
ALTER TABLE "fixed_costs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fixed_costs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "fixed_costs_org_unit_isolation" ON "fixed_costs"
  USING (
    "org_id" = current_setting('app.current_org', true)
    AND (
      current_setting('app.current_unit', true) IS NULL
      OR current_setting('app.current_unit', true) = ''
      OR "unit_id" = current_setting('app.current_unit', true)
    )
  )
  WITH CHECK ("org_id" = current_setting('app.current_org', true));--> statement-breakpoint
ALTER TABLE "fixed_cost_overrides" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fixed_cost_overrides" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "fixed_cost_overrides_org_unit_isolation" ON "fixed_cost_overrides"
  USING (
    "org_id" = current_setting('app.current_org', true)
    AND (
      current_setting('app.current_unit', true) IS NULL
      OR current_setting('app.current_unit', true) = ''
      OR "unit_id" = current_setting('app.current_unit', true)
    )
  )
  WITH CHECK ("org_id" = current_setting('app.current_org', true));