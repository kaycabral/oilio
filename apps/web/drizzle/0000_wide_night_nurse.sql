CREATE TABLE "agenda_blocks" (
	"org_id" text NOT NULL,
	"id" text NOT NULL,
	"unit_id" text NOT NULL,
	"last_event_version" bigint NOT NULL,
	"kind" text NOT NULL,
	"professional_id" text,
	"block" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "agenda_blocks_pkey" PRIMARY KEY("org_id","id"),
	CONSTRAINT "agenda_blocks_kind_check" CHECK ("agenda_blocks"."kind" IN ('recurring', 'one_off')),
	CONSTRAINT "agenda_blocks_unit_id_nonempty" CHECK (char_length(btrim("agenda_blocks"."unit_id")) > 0)
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"org_id" text NOT NULL,
	"id" text NOT NULL,
	"unit_id" text NOT NULL,
	"last_event_version" bigint NOT NULL,
	"professional_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"service_id" text NOT NULL,
	"customer_user_id" text NOT NULL,
	"professional_user_id" text,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"service_price_cents_snapshot" bigint NOT NULL,
	"service_duration_minutes_snapshot" bigint NOT NULL,
	"commission_snapshot" jsonb,
	"cancellation_policy_snapshot" jsonb,
	"tracking" jsonb,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "appointments_pkey" PRIMARY KEY("org_id","id"),
	CONSTRAINT "appointments_status_check" CHECK ("appointments"."status" IN ('scheduled', 'completed', 'cancelled', 'no_show')),
	CONSTRAINT "appointments_price_snapshot_nonneg" CHECK ("appointments"."service_price_cents_snapshot" >= 0),
	CONSTRAINT "appointments_duration_snapshot_nonneg" CHECK ("appointments"."service_duration_minutes_snapshot" >= 0)
);
--> statement-breakpoint
CREATE TABLE "cash_movements" (
	"org_id" text NOT NULL,
	"id" text NOT NULL,
	"unit_id" text NOT NULL,
	"last_event_version" bigint NOT NULL,
	"kind" text NOT NULL,
	"direction" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"payment_method" text,
	"order_id" text,
	"expense_category_id" text,
	"description" text,
	"recorded_by_uid" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "cash_movements_pkey" PRIMARY KEY("org_id","id"),
	CONSTRAINT "cash_movements_kind_check" CHECK ("cash_movements"."kind" IN ('sale', 'sale_reversal', 'sangria', 'suprimento', 'despesa')),
	CONSTRAINT "cash_movements_direction_check" CHECK ("cash_movements"."direction" IN ('in', 'out')),
	CONSTRAINT "cash_movements_amount_cents_nonneg" CHECK ("cash_movements"."amount_cents" >= 0),
	CONSTRAINT "cash_movements_kind_shape" CHECK ((
        "cash_movements"."kind" = 'sale'
        AND "cash_movements"."direction" = 'in'
        AND "cash_movements"."order_id" IS NOT NULL
        AND "cash_movements"."expense_category_id" IS NULL
      ) OR (
        "cash_movements"."kind" = 'sale_reversal'
        AND "cash_movements"."direction" = 'out'
        AND "cash_movements"."order_id" IS NOT NULL
        AND "cash_movements"."expense_category_id" IS NULL
      ) OR (
        "cash_movements"."kind" = 'despesa'
        AND "cash_movements"."direction" = 'out'
        AND "cash_movements"."order_id" IS NULL
        AND "cash_movements"."payment_method" IS NULL
      ) OR (
        "cash_movements"."kind" = 'sangria'
        AND "cash_movements"."direction" = 'out'
        AND "cash_movements"."order_id" IS NULL
        AND "cash_movements"."payment_method" IS NULL
        AND "cash_movements"."expense_category_id" IS NULL
      ) OR (
        "cash_movements"."kind" = 'suprimento'
        AND "cash_movements"."direction" = 'in'
        AND "cash_movements"."order_id" IS NULL
        AND "cash_movements"."payment_method" IS NULL
        AND "cash_movements"."expense_category_id" IS NULL
      ))
);
--> statement-breakpoint
CREATE TABLE "catalog_item_units" (
	"org_id" text NOT NULL,
	"catalog_item_id" text NOT NULL,
	"unit_id" text NOT NULL,
	CONSTRAINT "catalog_item_units_org_id_catalog_item_id_unit_id_pk" PRIMARY KEY("org_id","catalog_item_id","unit_id")
);
--> statement-breakpoint
CREATE TABLE "catalog_items" (
	"org_id" text NOT NULL,
	"id" text NOT NULL,
	"last_event_version" bigint NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"category_id" text,
	"price_cents" bigint NOT NULL,
	"price_visibility" text NOT NULL,
	"active" boolean NOT NULL,
	"archived_at" timestamp with time zone,
	"duration_minutes" bigint,
	"sku" text,
	"stock" bigint,
	"gtin14" text,
	"reconciliation_pending" boolean,
	"reconciliation_last_attempt" timestamp with time zone,
	"commission" jsonb,
	"unit_ids" jsonb NOT NULL,
	"unit_overrides" jsonb,
	"required_resources" jsonb,
	"public_visible" boolean NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "catalog_items_pkey" PRIMARY KEY("org_id","id"),
	CONSTRAINT "catalog_items_kind_check" CHECK ("catalog_items"."kind" IN ('service', 'product')),
	CONSTRAINT "catalog_items_name_nonempty" CHECK (char_length(btrim("catalog_items"."name")) > 0),
	CONSTRAINT "catalog_items_price_cents_nonneg" CHECK ("catalog_items"."price_cents" >= 0),
	CONSTRAINT "catalog_items_price_visibility_check" CHECK ("catalog_items"."price_visibility" IN ('visible', 'on_request')),
	CONSTRAINT "catalog_items_kind_shape" CHECK ((
        "catalog_items"."kind" = 'service'
        AND "catalog_items"."duration_minutes" IS NOT NULL
        AND "catalog_items"."sku" IS NULL
        AND "catalog_items"."stock" IS NULL
        AND "catalog_items"."gtin14" IS NULL
        AND "catalog_items"."reconciliation_pending" IS NULL
        AND "catalog_items"."reconciliation_last_attempt" IS NULL
      ) OR (
        "catalog_items"."kind" = 'product'
        AND "catalog_items"."duration_minutes" IS NULL
        AND "catalog_items"."stock" IS NOT NULL
      ))
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"org_id" text NOT NULL,
	"id" text NOT NULL,
	"last_event_version" bigint NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"color" text,
	"active" boolean NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "categories_pkey" PRIMARY KEY("org_id","id"),
	CONSTRAINT "categories_name_nonempty" CHECK (char_length(btrim("categories"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "charges" (
	"org_id" text NOT NULL,
	"id" text NOT NULL,
	"unit_id" text NOT NULL,
	"last_event_version" bigint NOT NULL,
	"subscription_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"period_start_at" timestamp with time zone NOT NULL,
	"period_end_at" timestamp with time zone NOT NULL,
	"due_date" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"attempts" bigint NOT NULL,
	"paid_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"failure_reason" text,
	"last_actor_uid" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "charges_pkey" PRIMARY KEY("org_id","id"),
	CONSTRAINT "charges_status_check" CHECK ("charges"."status" IN ('scheduled', 'paid', 'failed', 'recovering', 'refunded', 'cancelled')),
	CONSTRAINT "charges_amount_cents_nonneg" CHECK ("charges"."amount_cents" >= 0),
	CONSTRAINT "charges_attempts_nonneg" CHECK ("charges"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "commissions" (
	"org_id" text NOT NULL,
	"id" text NOT NULL,
	"last_event_version" bigint NOT NULL,
	"order_id" text NOT NULL,
	"order_item_id" text NOT NULL,
	"attributed_user_id" text NOT NULL,
	"attributed_member_name" text NOT NULL,
	"item_kind" text NOT NULL,
	"item_name" text NOT NULL,
	"item_total_cents" bigint NOT NULL,
	"commission_kind" text NOT NULL,
	"commission_value" bigint NOT NULL,
	"amount_cents" bigint NOT NULL,
	"liquidation_status" text NOT NULL,
	"paid_at" timestamp with time zone,
	"payment_proof" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "commissions_pkey" PRIMARY KEY("org_id","id"),
	CONSTRAINT "commissions_liquidation_status_check" CHECK ("commissions"."liquidation_status" IN ('pendente', 'pago')),
	CONSTRAINT "commissions_item_kind_check" CHECK ("commissions"."item_kind" IN ('service', 'product')),
	CONSTRAINT "commissions_commission_kind_check" CHECK ("commissions"."commission_kind" IN ('percentage', 'fixed')),
	CONSTRAINT "commissions_amount_cents_nonneg" CHECK ("commissions"."amount_cents" >= 0),
	CONSTRAINT "commissions_item_total_cents_nonneg" CHECK ("commissions"."item_total_cents" >= 0),
	CONSTRAINT "commissions_paid_at_iff_pago" CHECK (("commissions"."liquidation_status" = 'pago') = ("commissions"."paid_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"org_id" text NOT NULL,
	"id" text NOT NULL,
	"last_event_version" bigint NOT NULL,
	"user_id" text NOT NULL,
	"archived_at" timestamp with time zone,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "customers_pkey" PRIMARY KEY("org_id","id"),
	CONSTRAINT "customers_user_id_nonempty" CHECK (char_length(btrim("customers"."user_id")) > 0)
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"version" bigint NOT NULL,
	"org_id" text,
	"envelope" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_aggregate_id_version_key" UNIQUE("aggregate_id","version"),
	CONSTRAINT "events_version_positive" CHECK ("events"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"org_id" text NOT NULL,
	"id" text NOT NULL,
	"unit_id" text NOT NULL,
	"last_event_version" bigint NOT NULL,
	"period" text NOT NULL,
	"type" text NOT NULL,
	"target_cents" bigint NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "goals_pkey" PRIMARY KEY("org_id","id"),
	CONSTRAINT "goals_type_check" CHECK ("goals"."type" IN ('profit')),
	CONSTRAINT "goals_target_cents_positive" CHECK ("goals"."target_cents" >= 1),
	CONSTRAINT "goals_unit_id_nonempty" CHECK (char_length(btrim("goals"."unit_id")) > 0),
	CONSTRAINT "goals_period_nonempty" CHECK (char_length(btrim("goals"."period")) > 0)
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"org_id" text NOT NULL,
	"id" text NOT NULL,
	"last_event_version" bigint NOT NULL,
	"role" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"invited_by" text NOT NULL,
	"accepted_by_uid" text,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "invites_pkey" PRIMARY KEY("org_id","id"),
	CONSTRAINT "invites_role_check" CHECK ("invites"."role" IN ('owner', 'manager', 'professional', 'receptionist')),
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
CREATE TABLE "invites_pii" (
	"org_id" text NOT NULL,
	"id" text NOT NULL,
	"email" text NOT NULL,
	CONSTRAINT "invites_pii_pkey" PRIMARY KEY("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"org_id" text NOT NULL,
	"id" text NOT NULL,
	"user_id" text NOT NULL,
	"last_event_version" bigint NOT NULL,
	"role" text NOT NULL,
	"status" text NOT NULL,
	"rls_unit_scope" text,
	"invited_by" text,
	"joined_at" timestamp with time zone NOT NULL,
	"permissions" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "memberships_pkey" PRIMARY KEY("org_id","id"),
	CONSTRAINT "memberships_role_check" CHECK ("memberships"."role" IN ('owner', 'manager', 'professional', 'receptionist')),
	CONSTRAINT "memberships_status_check" CHECK ("memberships"."status" IN ('active', 'invited', 'suspended', 'revoked')),
	CONSTRAINT "memberships_user_id_nonempty" CHECK (char_length(btrim("memberships"."user_id")) > 0)
);
--> statement-breakpoint
CREATE TABLE "message_templates" (
	"org_id" text NOT NULL,
	"type" text NOT NULL,
	"body" text,
	"enabled" boolean NOT NULL,
	"last_actor_uid" text,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "message_templates_pkey" PRIMARY KEY("org_id","type"),
	CONSTRAINT "message_templates_type_nonempty" CHECK (char_length(btrim("message_templates"."type")) > 0)
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"org_id" text NOT NULL,
	"id" text NOT NULL,
	"unit_id" text NOT NULL,
	"last_event_version" bigint NOT NULL,
	"type" text NOT NULL,
	"source" text NOT NULL,
	"event_key" text NOT NULL,
	"customer_id" text,
	"appointment_id" text,
	"subscription_id" text,
	"read_at" timestamp with time zone,
	"dispatched_at" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"snoozed_until" timestamp with time zone,
	"payload" jsonb NOT NULL,
	"dispatch" jsonb,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	CONSTRAINT "notifications_pkey" PRIMARY KEY("org_id","id"),
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
CREATE TABLE "orders" (
	"org_id" text NOT NULL,
	"id" text NOT NULL,
	"unit_id" text NOT NULL,
	"last_event_version" bigint NOT NULL,
	"customer_id" text,
	"appointment_id" text,
	"status" text NOT NULL,
	"closed_at" timestamp with time zone,
	"payment_method" text,
	"discount_cents" bigint NOT NULL,
	"subtotal_cents" bigint NOT NULL,
	"total_cents" bigint NOT NULL,
	"items" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "orders_pkey" PRIMARY KEY("org_id","id"),
	CONSTRAINT "orders_status_check" CHECK ("orders"."status" IN ('open', 'closed', 'cancelled')),
	CONSTRAINT "orders_payment_method_check" CHECK ("orders"."payment_method" IS NULL OR "orders"."payment_method" IN ('cash', 'credit_card', 'debit_card', 'pix')),
	CONSTRAINT "orders_status_shape" CHECK ((
        "orders"."status" = 'open'
        AND "orders"."closed_at" IS NULL
        AND "orders"."payment_method" IS NULL
      ) OR (
        "orders"."status" = 'cancelled'
        AND "orders"."closed_at" IS NULL
        AND "orders"."payment_method" IS NULL
      ) OR (
        "orders"."status" = 'closed'
        AND "orders"."closed_at" IS NOT NULL
      )),
	CONSTRAINT "orders_discount_cents_nonneg" CHECK ("orders"."discount_cents" >= 0),
	CONSTRAINT "orders_subtotal_cents_nonneg" CHECK ("orders"."subtotal_cents" >= 0),
	CONSTRAINT "orders_total_cents_nonneg" CHECK ("orders"."total_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "org_links" (
	"user_id" text NOT NULL,
	"org_id" text NOT NULL,
	"linked_at" timestamp with time zone NOT NULL,
	CONSTRAINT "org_links_pkey" PRIMARY KEY("user_id","org_id")
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"org_id" text NOT NULL,
	"id" text NOT NULL,
	"last_event_version" bigint NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"vertical" text NOT NULL,
	"website" text,
	"owner_user_id" text NOT NULL,
	"branding" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "orgs_pkey" PRIMARY KEY("org_id"),
	CONSTRAINT "orgs_vertical_check" CHECK ("orgs"."vertical" IN ('barbershop', 'auto_wash', 'auto_detailing', 'other')),
	CONSTRAINT "orgs_name_nonempty" CHECK (char_length(btrim("orgs"."name")) > 0),
	CONSTRAINT "orgs_slug_nonempty" CHECK (char_length(btrim("orgs"."slug")) > 0),
	CONSTRAINT "orgs_owner_user_id_nonempty" CHECK (char_length(btrim("orgs"."owner_user_id")) > 0)
);
--> statement-breakpoint
CREATE TABLE "pii_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pii_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"event" text NOT NULL,
	"org_id" text,
	"subject_ref" text NOT NULL,
	"scope" text NOT NULL,
	"requested_by" text,
	"fields_changed" jsonb,
	"ts" timestamp with time zone NOT NULL,
	CONSTRAINT "pii_events_event_check" CHECK ("pii_events"."event" IN ('pii_erasure_requested', 'pii_anonymized', 'pii_rectified')),
	CONSTRAINT "pii_events_subject_ref_nonempty" CHECK (char_length(btrim("pii_events"."subject_ref")) > 0)
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
CREATE TABLE "product_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "product_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"event" text NOT NULL,
	"gtin14" text,
	"result" text,
	"source" text,
	"latency_ms" bigint,
	"query_len" bigint,
	"result_count" bigint,
	"reason" text,
	"ts" timestamp with time zone NOT NULL,
	CONSTRAINT "product_events_event_check" CHECK ("product_events"."event" IN (
        'product_lookup',
        'product_search',
        'product_autocontributed',
        'product_contribution_deferred'
      ))
);
--> statement-breakpoint
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
CREATE TABLE "professionals" (
	"org_id" text NOT NULL,
	"id" text NOT NULL,
	"last_event_version" bigint NOT NULL,
	"user_id" text NOT NULL,
	"default_commission" jsonb,
	"unit_ids" jsonb NOT NULL,
	"catalog_service_ids" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "professionals_pkey" PRIMARY KEY("org_id","id"),
	CONSTRAINT "professionals_user_id_nonempty" CHECK (char_length(btrim("professionals"."user_id")) > 0)
);
--> statement-breakpoint
CREATE TABLE "professionals_pii" (
	"org_id" text NOT NULL,
	"id" text NOT NULL,
	"tax_identity" jsonb,
	CONSTRAINT "professionals_pii_pkey" PRIMARY KEY("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "projections" (
	"org_id" text NOT NULL,
	"id" text NOT NULL,
	"state" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projections_pkey" PRIMARY KEY("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "public_org_directory" (
	"org_id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"vertical" text NOT NULL,
	"website" text,
	"owner_user_id" text NOT NULL,
	"branding" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_plans" (
	"org_id" text NOT NULL,
	"id" text NOT NULL,
	"last_event_version" bigint NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_cents" bigint NOT NULL,
	"billing_cycle" text NOT NULL,
	"active" boolean NOT NULL,
	"archived_at" timestamp with time zone,
	"usage_limit_kind" text NOT NULL,
	"usage_limit" jsonb NOT NULL,
	"included_item_ids" jsonb NOT NULL,
	"included_category_ids" jsonb NOT NULL,
	"unit_allowlist" jsonb,
	"allowed_time_scope" jsonb,
	"booking_limits" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "subscription_plans_pkey" PRIMARY KEY("org_id","id"),
	CONSTRAINT "subscription_plans_name_nonempty" CHECK (char_length(btrim("subscription_plans"."name")) > 0),
	CONSTRAINT "subscription_plans_price_cents_nonneg" CHECK ("subscription_plans"."price_cents" >= 0),
	CONSTRAINT "subscription_plans_billing_cycle_check" CHECK ("subscription_plans"."billing_cycle" IN ('monthly', 'quarterly', 'semiannual', 'annual')),
	CONSTRAINT "subscription_plans_usage_limit_kind_check" CHECK ("subscription_plans"."usage_limit_kind" IN ('unlimited', 'count'))
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"org_id" text NOT NULL,
	"id" text NOT NULL,
	"unit_id" text NOT NULL,
	"last_event_version" bigint NOT NULL,
	"customer_id" text NOT NULL,
	"customer_user_id" text,
	"status" text NOT NULL,
	"billing_cycle" text NOT NULL,
	"cancel_at_period_end" boolean NOT NULL,
	"next_charge_date" timestamp with time zone,
	"past_due_cycles" bigint NOT NULL,
	"past_due_threshold" bigint NOT NULL,
	"cancellation_reason" text,
	"cancelled_at" timestamp with time zone,
	"plan" jsonb NOT NULL,
	"current_period" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "subscriptions_pkey" PRIMARY KEY("org_id","id"),
	CONSTRAINT "subscriptions_status_check" CHECK ("subscriptions"."status" IN ('pending', 'active', 'past_due', 'suspended', 'cancelled', 'cancelled_for_non_payment')),
	CONSTRAINT "subscriptions_billing_cycle_check" CHECK ("subscriptions"."billing_cycle" IN ('monthly', 'quarterly', 'semiannual', 'annual')),
	CONSTRAINT "subscriptions_past_due_cycles_nonneg" CHECK ("subscriptions"."past_due_cycles" >= 0),
	CONSTRAINT "subscriptions_past_due_threshold_nonneg" CHECK ("subscriptions"."past_due_threshold" >= 0)
);
--> statement-breakpoint
CREATE TABLE "unit_tax_identity" (
	"org_id" text NOT NULL,
	"id" text NOT NULL,
	"tax_identity" jsonb,
	CONSTRAINT "unit_tax_identity_pkey" PRIMARY KEY("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "units" (
	"org_id" text NOT NULL,
	"id" text NOT NULL,
	"last_event_version" bigint NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"timezone" text NOT NULL,
	"archived_at" timestamp with time zone,
	"agenda_mode" text NOT NULL,
	"fiscal_kind" text NOT NULL,
	"address" jsonb NOT NULL,
	"agenda" jsonb NOT NULL,
	"fiscal" jsonb NOT NULL,
	"public_visible" boolean,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "units_pkey" PRIMARY KEY("org_id","id"),
	CONSTRAINT "units_agenda_mode_check" CHECK ("units"."agenda_mode" IN ('fixed', 'always_open', 'appointment')),
	CONSTRAINT "units_fiscal_kind_check" CHECK ("units"."fiscal_kind" IN ('informal', 'company')),
	CONSTRAINT "units_name_nonempty" CHECK (char_length(btrim("units"."name")) > 0),
	CONSTRAINT "units_slug_nonempty" CHECK (char_length(btrim("units"."slug")) > 0),
	CONSTRAINT "units_timezone_nonempty" CHECK (char_length(btrim("units"."timezone")) > 0)
);
--> statement-breakpoint
CREATE TABLE "units_pii" (
	"org_id" text NOT NULL,
	"id" text NOT NULL,
	"whatsapp" text NOT NULL,
	"email" text,
	CONSTRAINT "units_pii_pkey" PRIMARY KEY("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"uid" text PRIMARY KEY NOT NULL,
	"email" text,
	"display_name" text,
	"avatar_url" text,
	"email_verified" boolean NOT NULL,
	"current_org_id" text,
	"whatsapp" text,
	"birth_date" text,
	"bio" text,
	"completion_completed" boolean NOT NULL,
	"claimed_at" timestamp with time zone,
	"terms_accepted_at" timestamp with time zone,
	"terms_version" text,
	"privacy_accepted_at" timestamp with time zone,
	"privacy_version" text,
	"anonymized_at" timestamp with time zone,
	"tax_identity" jsonb,
	"specialties" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "users_anonymized_pii_scrubbed" CHECK ("users"."anonymized_at" IS NULL OR ("users"."whatsapp" IS NULL AND "users"."birth_date" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "agenda_blocks" ADD CONSTRAINT "agenda_blocks_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agenda_blocks" ADD CONSTRAINT "agenda_blocks_unit_id_fk" FOREIGN KEY ("org_id","unit_id") REFERENCES "public"."units"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agenda_blocks" ADD CONSTRAINT "agenda_blocks_professional_id_fk" FOREIGN KEY ("org_id","professional_id") REFERENCES "public"."professionals"("org_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_unit_id_fk" FOREIGN KEY ("org_id","unit_id") REFERENCES "public"."units"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_professional_id_fk" FOREIGN KEY ("org_id","professional_id") REFERENCES "public"."professionals"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_customer_id_fk" FOREIGN KEY ("org_id","customer_id") REFERENCES "public"."customers"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_service_id_fk" FOREIGN KEY ("org_id","service_id") REFERENCES "public"."catalog_items"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_unit_id_fk" FOREIGN KEY ("org_id","unit_id") REFERENCES "public"."units"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_order_id_fk" FOREIGN KEY ("org_id","order_id") REFERENCES "public"."orders"("org_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_item_units" ADD CONSTRAINT "catalog_item_units_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_item_units" ADD CONSTRAINT "catalog_item_units_catalog_item_id_fk" FOREIGN KEY ("org_id","catalog_item_id") REFERENCES "public"."catalog_items"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_item_units" ADD CONSTRAINT "catalog_item_units_unit_id_fk" FOREIGN KEY ("org_id","unit_id") REFERENCES "public"."units"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_category_id_fk" FOREIGN KEY ("org_id","category_id") REFERENCES "public"."categories"("org_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_subscription_id_fk" FOREIGN KEY ("org_id","subscription_id") REFERENCES "public"."subscriptions"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_customer_id_fk" FOREIGN KEY ("org_id","customer_id") REFERENCES "public"."customers"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_order_id_fk" FOREIGN KEY ("org_id","order_id") REFERENCES "public"."orders"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_unit_id_fk" FOREIGN KEY ("org_id","unit_id") REFERENCES "public"."units"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites_pii" ADD CONSTRAINT "invites_pii_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_rls_unit_scope_fk" FOREIGN KEY ("org_id","rls_unit_scope") REFERENCES "public"."units"("org_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_unit_id_fk" FOREIGN KEY ("org_id","unit_id") REFERENCES "public"."units"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fk" FOREIGN KEY ("org_id","customer_id") REFERENCES "public"."customers"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_appointment_id_fk" FOREIGN KEY ("org_id","appointment_id") REFERENCES "public"."appointments"("org_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_included_categories" ADD CONSTRAINT "plan_included_categories_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_included_categories" ADD CONSTRAINT "plan_included_categories_plan_id_fk" FOREIGN KEY ("org_id","plan_id") REFERENCES "public"."subscription_plans"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_included_categories" ADD CONSTRAINT "plan_included_categories_category_id_fk" FOREIGN KEY ("org_id","category_id") REFERENCES "public"."categories"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_included_items" ADD CONSTRAINT "plan_included_items_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_included_items" ADD CONSTRAINT "plan_included_items_plan_id_fk" FOREIGN KEY ("org_id","plan_id") REFERENCES "public"."subscription_plans"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_included_items" ADD CONSTRAINT "plan_included_items_item_id_fk" FOREIGN KEY ("org_id","item_id") REFERENCES "public"."catalog_items"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_unit_allowlist" ADD CONSTRAINT "plan_unit_allowlist_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_unit_allowlist" ADD CONSTRAINT "plan_unit_allowlist_plan_id_fk" FOREIGN KEY ("org_id","plan_id") REFERENCES "public"."subscription_plans"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_unit_allowlist" ADD CONSTRAINT "plan_unit_allowlist_unit_id_fk" FOREIGN KEY ("org_id","unit_id") REFERENCES "public"."units"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_services" ADD CONSTRAINT "professional_services_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_services" ADD CONSTRAINT "professional_services_professional_id_fk" FOREIGN KEY ("org_id","professional_id") REFERENCES "public"."professionals"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_services" ADD CONSTRAINT "professional_services_service_id_fk" FOREIGN KEY ("org_id","service_id") REFERENCES "public"."catalog_items"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_units" ADD CONSTRAINT "professional_units_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_units" ADD CONSTRAINT "professional_units_professional_id_fk" FOREIGN KEY ("org_id","professional_id") REFERENCES "public"."professionals"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_units" ADD CONSTRAINT "professional_units_unit_id_fk" FOREIGN KEY ("org_id","unit_id") REFERENCES "public"."units"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professionals" ADD CONSTRAINT "professionals_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professionals_pii" ADD CONSTRAINT "professionals_pii_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD CONSTRAINT "subscription_plans_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_unit_id_fk" FOREIGN KEY ("org_id","unit_id") REFERENCES "public"."units"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_customer_id_fk" FOREIGN KEY ("org_id","customer_id") REFERENCES "public"."customers"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_tax_identity" ADD CONSTRAINT "unit_tax_identity_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units_pii" ADD CONSTRAINT "units_pii_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agenda_blocks_org_id_unit_id_idx" ON "agenda_blocks" USING btree ("org_id","unit_id");--> statement-breakpoint
CREATE INDEX "appointments_org_id_unit_id_start_idx" ON "appointments" USING btree ("org_id","unit_id","start_at");--> statement-breakpoint
CREATE INDEX "appointments_org_id_professional_idx" ON "appointments" USING btree ("org_id","professional_id");--> statement-breakpoint
CREATE INDEX "cash_movements_org_id_created_at_idx" ON "cash_movements" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "cash_movements_org_id_order_idx" ON "cash_movements" USING btree ("org_id","order_id");--> statement-breakpoint
CREATE INDEX "catalog_item_units_org_id_unit_id_idx" ON "catalog_item_units" USING btree ("org_id","unit_id");--> statement-breakpoint
CREATE INDEX "catalog_items_org_id_name_idx" ON "catalog_items" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "catalog_items_org_id_active_idx" ON "catalog_items" USING btree ("org_id","active");--> statement-breakpoint
CREATE INDEX "categories_org_id_name_idx" ON "categories" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "charges_org_id_subscription_idx" ON "charges" USING btree ("org_id","subscription_id");--> statement-breakpoint
CREATE INDEX "charges_org_id_status_idx" ON "charges" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "commissions_org_id_attributed_user_idx" ON "commissions" USING btree ("org_id","attributed_user_id");--> statement-breakpoint
CREATE INDEX "commissions_org_id_order_idx" ON "commissions" USING btree ("org_id","order_id");--> statement-breakpoint
CREATE INDEX "customers_org_id_user_id_idx" ON "customers" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "events_aggregate_id_version_idx" ON "events" USING btree ("aggregate_id","version");--> statement-breakpoint
CREATE INDEX "events_org_id_idx" ON "events" USING btree ("org_id","aggregate_type","version");--> statement-breakpoint
CREATE INDEX "goals_org_id_unit_id_idx" ON "goals" USING btree ("org_id","unit_id");--> statement-breakpoint
CREATE INDEX "invites_org_id_status_idx" ON "invites" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "invites_pii_org_id_idx" ON "invites_pii" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "memberships_org_id_user_id_idx" ON "memberships" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_user_id_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "message_templates_org_id_type_idx" ON "message_templates" USING btree ("org_id","type");--> statement-breakpoint
CREATE INDEX "notifications_org_id_unit_id_idx" ON "notifications" USING btree ("org_id","unit_id");--> statement-breakpoint
CREATE INDEX "notifications_org_id_event_key_idx" ON "notifications" USING btree ("org_id","event_key");--> statement-breakpoint
CREATE INDEX "orders_org_id_status_idx" ON "orders" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "orders_org_id_appointment_idx" ON "orders" USING btree ("org_id","appointment_id");--> statement-breakpoint
CREATE INDEX "org_links_user_id_idx" ON "org_links" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "orgs_slug_idx" ON "orgs" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "pii_events_subject_ref_idx" ON "pii_events" USING btree ("subject_ref");--> statement-breakpoint
CREATE INDEX "pii_events_org_id_ts_idx" ON "pii_events" USING btree ("org_id","ts");--> statement-breakpoint
CREATE INDEX "plan_included_categories_org_id_category_id_idx" ON "plan_included_categories" USING btree ("org_id","category_id");--> statement-breakpoint
CREATE INDEX "plan_included_items_org_id_item_id_idx" ON "plan_included_items" USING btree ("org_id","item_id");--> statement-breakpoint
CREATE INDEX "plan_unit_allowlist_org_id_unit_id_idx" ON "plan_unit_allowlist" USING btree ("org_id","unit_id");--> statement-breakpoint
CREATE INDEX "product_events_gtin14_ts_idx" ON "product_events" USING btree ("gtin14","ts");--> statement-breakpoint
CREATE INDEX "product_events_event_ts_idx" ON "product_events" USING btree ("event","ts");--> statement-breakpoint
CREATE INDEX "professional_services_org_id_service_id_idx" ON "professional_services" USING btree ("org_id","service_id");--> statement-breakpoint
CREATE INDEX "professional_units_org_id_unit_id_idx" ON "professional_units" USING btree ("org_id","unit_id");--> statement-breakpoint
CREATE INDEX "professionals_org_id_user_id_idx" ON "professionals" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "professionals_pii_org_id_idx" ON "professionals_pii" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "public_org_directory_slug_idx" ON "public_org_directory" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "subscription_plans_org_id_name_idx" ON "subscription_plans" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "subscriptions_org_id_customer_idx" ON "subscriptions" USING btree ("org_id","customer_id");--> statement-breakpoint
CREATE INDEX "subscriptions_org_id_status_idx" ON "subscriptions" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "unit_tax_identity_org_id_idx" ON "unit_tax_identity" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "units_org_id_name_idx" ON "units" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "units_org_id_slug_idx" ON "units" USING btree ("org_id","slug");--> statement-breakpoint
CREATE INDEX "units_pii_org_id_idx" ON "units_pii" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");