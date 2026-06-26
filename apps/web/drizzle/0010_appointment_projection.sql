CREATE TABLE "appointments" (
	"aggregate_path" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"id" text NOT NULL,
	"unit_id" text NOT NULL,
	"version" bigint NOT NULL,
	"professional_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"service_id" text NOT NULL,
	"customer_user_id" text NOT NULL,
	"professional_user_id" text,
	"start_at" text NOT NULL,
	"end_at" text NOT NULL,
	"status" text NOT NULL,
	"service_price_cents_snapshot" bigint NOT NULL,
	"service_duration_minutes_snapshot" bigint NOT NULL,
	"commission_snapshot" jsonb,
	"cancellation_policy_snapshot" jsonb,
	"tracking" jsonb,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "appointments_status_check" CHECK ("appointments"."status" IN ('scheduled', 'completed', 'cancelled', 'no_show')),
	CONSTRAINT "appointments_price_snapshot_nonneg" CHECK ("appointments"."service_price_cents_snapshot" >= 0),
	CONSTRAINT "appointments_duration_snapshot_nonneg" CHECK ("appointments"."service_duration_minutes_snapshot" >= 0)
);
--> statement-breakpoint
CREATE INDEX "appointments_org_id_unit_id_start_idx" ON "appointments" USING btree ("org_id","unit_id","start_at");--> statement-breakpoint
CREATE INDEX "appointments_org_id_professional_idx" ON "appointments" USING btree ("org_id","professional_id");