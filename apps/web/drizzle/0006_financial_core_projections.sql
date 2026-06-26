CREATE TABLE "cash_movements" (
	"aggregate_path" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"id" text NOT NULL,
	"unit_id" text NOT NULL,
	"version" bigint NOT NULL,
	"kind" text NOT NULL,
	"direction" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"payment_method" text,
	"order_id" text,
	"expense_category_id" text,
	"description" text,
	"recorded_by_uid" text NOT NULL,
	"created_at" text NOT NULL,
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
CREATE TABLE "commissions" (
	"aggregate_path" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"id" text NOT NULL,
	"version" bigint NOT NULL,
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
	"paid_at" text,
	"payment_proof" text,
	"created_at" text NOT NULL,
	CONSTRAINT "commissions_liquidation_status_check" CHECK ("commissions"."liquidation_status" IN ('pendente', 'pago')),
	CONSTRAINT "commissions_item_kind_check" CHECK ("commissions"."item_kind" IN ('service', 'product')),
	CONSTRAINT "commissions_commission_kind_check" CHECK ("commissions"."commission_kind" IN ('percentage', 'fixed')),
	CONSTRAINT "commissions_amount_cents_nonneg" CHECK ("commissions"."amount_cents" >= 0),
	CONSTRAINT "commissions_item_total_cents_nonneg" CHECK ("commissions"."item_total_cents" >= 0),
	CONSTRAINT "commissions_paid_at_iff_pago" CHECK (("commissions"."liquidation_status" = 'pago') = ("commissions"."paid_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"aggregate_path" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"id" text NOT NULL,
	"unit_id" text NOT NULL,
	"version" bigint NOT NULL,
	"customer_id" text,
	"appointment_id" text,
	"status" text NOT NULL,
	"closed_at" text,
	"payment_method" text,
	"discount_cents" bigint NOT NULL,
	"subtotal_cents" bigint NOT NULL,
	"total_cents" bigint NOT NULL,
	"items" jsonb NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
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
CREATE INDEX "cash_movements_org_id_created_at_idx" ON "cash_movements" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "cash_movements_org_id_order_idx" ON "cash_movements" USING btree ("org_id","order_id");--> statement-breakpoint
CREATE INDEX "commissions_org_id_attributed_user_idx" ON "commissions" USING btree ("org_id","attributed_user_id");--> statement-breakpoint
CREATE INDEX "commissions_org_id_order_idx" ON "commissions" USING btree ("org_id","order_id");--> statement-breakpoint
CREATE INDEX "orders_org_id_status_idx" ON "orders" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "orders_org_id_appointment_idx" ON "orders" USING btree ("org_id","appointment_id");