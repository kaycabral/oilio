CREATE TABLE "agenda_blocks" (
	"aggregate_path" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"id" text NOT NULL,
	"unit_id" text NOT NULL,
	"version" bigint NOT NULL,
	"kind" text NOT NULL,
	"professional_id" text,
	"block" jsonb NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "agenda_blocks_kind_check" CHECK ("agenda_blocks"."kind" IN ('recurring', 'one_off')),
	CONSTRAINT "agenda_blocks_unit_id_nonempty" CHECK (char_length(btrim("agenda_blocks"."unit_id")) > 0)
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"aggregate_path" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"id" text NOT NULL,
	"version" bigint NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"color" text,
	"active" boolean NOT NULL,
	"archived_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "categories_name_nonempty" CHECK (char_length(btrim("categories"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"aggregate_path" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"id" text NOT NULL,
	"version" bigint NOT NULL,
	"user_id" text NOT NULL,
	"archived_at" text,
	"deactivated_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "customers_user_id_nonempty" CHECK (char_length(btrim("customers"."user_id")) > 0)
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"aggregate_path" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"id" text NOT NULL,
	"unit_id" text NOT NULL,
	"version" bigint NOT NULL,
	"period" text NOT NULL,
	"type" text NOT NULL,
	"target_cents" bigint NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "goals_type_check" CHECK ("goals"."type" IN ('profit')),
	CONSTRAINT "goals_target_cents_positive" CHECK ("goals"."target_cents" >= 1),
	CONSTRAINT "goals_unit_id_nonempty" CHECK (char_length(btrim("goals"."unit_id")) > 0),
	CONSTRAINT "goals_period_nonempty" CHECK (char_length(btrim("goals"."period")) > 0)
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"aggregate_path" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"id" text NOT NULL,
	"version" bigint NOT NULL,
	"role" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" text NOT NULL,
	"status" text NOT NULL,
	"invited_by" text NOT NULL,
	"accepted_by_uid" text,
	"accepted_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "invites_role_check" CHECK ("invites"."role" IN ('owner', 'manager', 'professional', 'receptionist', 'customer')),
	CONSTRAINT "invites_status_check" CHECK ("invites"."status" IN ('pending', 'accepted', 'expired', 'revoked')),
	CONSTRAINT "invites_acceptance_consistency" CHECK ((
        "invites"."status" = 'accepted'
        AND "invites"."accepted_by_uid" IS NOT NULL
        AND "invites"."accepted_at" IS NOT NULL
      ) OR (
        "invites"."status" = 'pending'
        AND "invites"."accepted_by_uid" IS NULL
        AND "invites"."accepted_at" IS NULL
      ) OR "invites"."status" IN ('expired', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"aggregate_path" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"id" text NOT NULL,
	"unit_id" text NOT NULL,
	"version" bigint NOT NULL,
	"type" text NOT NULL,
	"source" text NOT NULL,
	"event_key" text NOT NULL,
	"customer_id" text,
	"appointment_id" text,
	"subscription_id" text,
	"read_at" text,
	"dispatched_at" text,
	"valid_until" text,
	"snoozed_until" text,
	"payload" jsonb NOT NULL,
	"dispatch" jsonb,
	"created_at" text,
	"updated_at" text,
	CONSTRAINT "notifications_type_check" CHECK ("notifications"."type" IN (
        'birthday',
        'subscription_expiring_tomorrow',
        'subscription_expired',
        'subscription_overdue_followup',
        'order_stale',
        'cash_register_open',
        'new_customer',
        'payment_failure'
      )),
	CONSTRAINT "notifications_source_check" CHECK ("notifications"."source" IN ('cron', 'event')),
	CONSTRAINT "notifications_unit_id_nonempty" CHECK (char_length(btrim("notifications"."unit_id")) > 0)
);
--> statement-breakpoint
CREATE TABLE "professionals" (
	"aggregate_path" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"id" text NOT NULL,
	"version" bigint NOT NULL,
	"user_id" text NOT NULL,
	"operational_status" text NOT NULL,
	"default_commission" jsonb,
	"unit_ids" jsonb NOT NULL,
	"catalog_service_ids" jsonb NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "professionals_operational_status_check" CHECK ("professionals"."operational_status" IN ('incomplete', 'operational')),
	CONSTRAINT "professionals_user_id_nonempty" CHECK (char_length(btrim("professionals"."user_id")) > 0)
);
--> statement-breakpoint
CREATE TABLE "subscription_plans" (
	"aggregate_path" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"id" text NOT NULL,
	"version" bigint NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_cents" bigint NOT NULL,
	"billing_cycle" text NOT NULL,
	"active" boolean NOT NULL,
	"archived_at" text,
	"usage_limit_kind" text NOT NULL,
	"usage_limit" jsonb NOT NULL,
	"included_item_ids" jsonb NOT NULL,
	"included_category_ids" jsonb NOT NULL,
	"unit_allowlist" jsonb,
	"allowed_time_scope" jsonb,
	"booking_limits" jsonb,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "subscription_plans_name_nonempty" CHECK (char_length(btrim("subscription_plans"."name")) > 0),
	CONSTRAINT "subscription_plans_price_cents_nonneg" CHECK ("subscription_plans"."price_cents" >= 0),
	CONSTRAINT "subscription_plans_billing_cycle_check" CHECK ("subscription_plans"."billing_cycle" IN ('monthly', 'quarterly', 'semiannual', 'annual')),
	CONSTRAINT "subscription_plans_usage_limit_kind_check" CHECK ("subscription_plans"."usage_limit_kind" IN ('unlimited', 'count'))
);
--> statement-breakpoint
ALTER TABLE "agenda_blocks" ADD CONSTRAINT "agenda_blocks_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professionals" ADD CONSTRAINT "professionals_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD CONSTRAINT "subscription_plans_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agenda_blocks_org_id_unit_id_idx" ON "agenda_blocks" USING btree ("org_id","unit_id");--> statement-breakpoint
CREATE INDEX "categories_org_id_name_idx" ON "categories" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "customers_org_id_user_id_idx" ON "customers" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "goals_org_id_unit_id_idx" ON "goals" USING btree ("org_id","unit_id");--> statement-breakpoint
CREATE INDEX "invites_org_id_status_idx" ON "invites" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "notifications_org_id_unit_id_idx" ON "notifications" USING btree ("org_id","unit_id");--> statement-breakpoint
CREATE INDEX "notifications_org_id_event_key_idx" ON "notifications" USING btree ("org_id","event_key");--> statement-breakpoint
CREATE INDEX "professionals_org_id_user_id_idx" ON "professionals" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "subscription_plans_org_id_name_idx" ON "subscription_plans" USING btree ("org_id","name");