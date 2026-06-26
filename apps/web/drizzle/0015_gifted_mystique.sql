ALTER TABLE "cash_movements" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at"::timestamptz;--> statement-breakpoint
ALTER TABLE "charges" ALTER COLUMN "period_start_at" SET DATA TYPE timestamp with time zone USING "period_start_at"::timestamptz;--> statement-breakpoint
ALTER TABLE "charges" ALTER COLUMN "period_end_at" SET DATA TYPE timestamp with time zone USING "period_end_at"::timestamptz;--> statement-breakpoint
ALTER TABLE "charges" ALTER COLUMN "due_date" SET DATA TYPE timestamp with time zone USING "due_date"::timestamptz;--> statement-breakpoint
ALTER TABLE "charges" ALTER COLUMN "paid_at" SET DATA TYPE timestamp with time zone USING "paid_at"::timestamptz;--> statement-breakpoint
ALTER TABLE "charges" ALTER COLUMN "failed_at" SET DATA TYPE timestamp with time zone USING "failed_at"::timestamptz;--> statement-breakpoint
ALTER TABLE "charges" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at"::timestamptz;--> statement-breakpoint
ALTER TABLE "charges" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at"::timestamptz;--> statement-breakpoint
ALTER TABLE "commissions" ALTER COLUMN "paid_at" SET DATA TYPE timestamp with time zone USING "paid_at"::timestamptz;--> statement-breakpoint
ALTER TABLE "commissions" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at"::timestamptz;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "closed_at" SET DATA TYPE timestamp with time zone USING "closed_at"::timestamptz;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at"::timestamptz;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at"::timestamptz;--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "next_charge_date" SET DATA TYPE timestamp with time zone USING "next_charge_date"::timestamptz;--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "cancelled_at" SET DATA TYPE timestamp with time zone USING "cancelled_at"::timestamptz;--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at"::timestamptz;--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at"::timestamptz;