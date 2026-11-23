CREATE TABLE "org_billing" (
	"org_id" text NOT NULL,
	"id" text NOT NULL,
	"last_event_version" bigint NOT NULL,
	"tier" text NOT NULL,
	"status" text NOT NULL,
	"billing_cycle" text,
	"unit_quantity" integer DEFAULT 1 NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "org_billing_pkey" PRIMARY KEY("org_id"),
	CONSTRAINT "org_billing_tier_check" CHECK ("org_billing"."tier" IN ('free', 'pro', 'advanced')),
	CONSTRAINT "org_billing_status_check" CHECK ("org_billing"."status" IN ('active', 'trialing', 'past_due', 'canceled', 'incomplete')),
	CONSTRAINT "org_billing_cycle_check" CHECK ("org_billing"."billing_cycle" IS NULL OR "org_billing"."billing_cycle" IN ('monthly', 'annual')),
	CONSTRAINT "org_billing_unit_quantity_nonneg" CHECK ("org_billing"."unit_quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "org_billing_stripe_index" (
	"stripe_customer_id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "org_billing_stripe_customer_idx" ON "org_billing" USING btree ("stripe_customer_id") WHERE "org_billing"."stripe_customer_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "org_billing_stripe_subscription_idx" ON "org_billing" USING btree ("stripe_subscription_id") WHERE "org_billing"."stripe_subscription_id" IS NOT NULL;--> statement-breakpoint

-- FK: org_billing.org_id → orgs.org_id. ON DELETE CASCADE — deleting a Negócio
-- drops its billing row (the stripe index row is dropped by the projector's
-- delete, which also runs in the org's tx).
ALTER TABLE "org_billing"
  ADD CONSTRAINT "org_billing_org_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "orgs"("org_id") ON DELETE cascade;--> statement-breakpoint

-- ── RLS: org_billing (org-only, brief 0071 AC-02) ─────────────────────────────
-- Same shape as orgs/units/catalog_items: org-scoped isolation by the
-- `app.current_org` GUC. FORCE applies the policy even to the table owner, so the
-- integration proof under a NOBYPASSRLS role is meaningful. The webhook writes
-- under this policy too — `emitEvent` sets `app.current_org` from the ref's orgId.
ALTER TABLE "org_billing" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "org_billing" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_billing_org_isolation" ON "org_billing"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));--> statement-breakpoint

-- org_billing_stripe_index is INTENTIONALLY NOT under RLS — it is the
-- session-less lookup (stripe_customer_id → org_id) the webhook reads on the raw
-- pool to resolve the org before it can set `app.current_org`. It carries only
-- the id mapping, no operational/billing data (mirrors public_org_directory).