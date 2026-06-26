CREATE TABLE "charges" (
	"aggregate_path" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"id" text NOT NULL,
	"unit_id" text NOT NULL,
	"version" bigint NOT NULL,
	"subscription_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"period_start_at" text NOT NULL,
	"period_end_at" text NOT NULL,
	"due_date" text NOT NULL,
	"status" text NOT NULL,
	"attempts" bigint NOT NULL,
	"paid_at" text,
	"failed_at" text,
	"failure_reason" text,
	"last_actor_uid" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "charges_status_check" CHECK ("charges"."status" IN ('scheduled', 'paid', 'failed', 'recovering', 'refunded', 'cancelled')),
	CONSTRAINT "charges_amount_cents_nonneg" CHECK ("charges"."amount_cents" >= 0),
	CONSTRAINT "charges_attempts_nonneg" CHECK ("charges"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"aggregate_path" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"id" text NOT NULL,
	"unit_id" text NOT NULL,
	"version" bigint NOT NULL,
	"customer_id" text NOT NULL,
	"customer_user_id" text,
	"status" text NOT NULL,
	"billing_cycle" text NOT NULL,
	"cancel_at_period_end" boolean NOT NULL,
	"next_charge_date" text,
	"past_due_cycles" bigint NOT NULL,
	"past_due_threshold" bigint NOT NULL,
	"cancellation_reason" text,
	"cancelled_at" text,
	"plan" jsonb NOT NULL,
	"current_period" jsonb NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "subscriptions_status_check" CHECK ("subscriptions"."status" IN ('pending', 'active', 'past_due', 'suspended', 'cancelled', 'cancelled_for_non_payment')),
	CONSTRAINT "subscriptions_billing_cycle_check" CHECK ("subscriptions"."billing_cycle" IN ('monthly', 'quarterly', 'semiannual', 'annual')),
	CONSTRAINT "subscriptions_past_due_cycles_nonneg" CHECK ("subscriptions"."past_due_cycles" >= 0),
	CONSTRAINT "subscriptions_past_due_threshold_nonneg" CHECK ("subscriptions"."past_due_threshold" >= 0)
);
--> statement-breakpoint
CREATE INDEX "charges_org_id_subscription_idx" ON "charges" USING btree ("org_id","subscription_id");--> statement-breakpoint
CREATE INDEX "charges_org_id_status_idx" ON "charges" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "subscriptions_org_id_customer_idx" ON "subscriptions" USING btree ("org_id","customer_id");--> statement-breakpoint
CREATE INDEX "subscriptions_org_id_status_idx" ON "subscriptions" USING btree ("org_id","status");