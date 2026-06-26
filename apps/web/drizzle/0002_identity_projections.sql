CREATE TABLE "memberships" (
	"aggregate_path" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"id" text NOT NULL,
	"user_id" text NOT NULL,
	"version" bigint NOT NULL,
	"role" text NOT NULL,
	"status" text NOT NULL,
	"unit_id" text,
	"invited_by" text,
	"commission_rate" double precision,
	"joined_at" text NOT NULL,
	"permissions" jsonb NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "memberships_role_check" CHECK ("memberships"."role" IN ('owner', 'manager', 'professional', 'receptionist', 'customer')),
	CONSTRAINT "memberships_status_check" CHECK ("memberships"."status" IN ('active', 'invited', 'suspended', 'revoked')),
	CONSTRAINT "memberships_user_id_nonempty" CHECK (char_length(btrim("memberships"."user_id")) > 0)
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"aggregate_path" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"id" text NOT NULL,
	"version" bigint NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"vertical" text NOT NULL,
	"website" text,
	"owner_user_id" text NOT NULL,
	"branding" jsonb NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "orgs_org_id_unique" UNIQUE("org_id"),
	CONSTRAINT "orgs_vertical_check" CHECK ("orgs"."vertical" IN ('barbershop', 'auto_wash', 'auto_detailing', 'other')),
	CONSTRAINT "orgs_name_nonempty" CHECK (char_length(btrim("orgs"."name")) > 0),
	CONSTRAINT "orgs_slug_nonempty" CHECK (char_length(btrim("orgs"."slug")) > 0),
	CONSTRAINT "orgs_owner_user_id_nonempty" CHECK (char_length(btrim("orgs"."owner_user_id")) > 0)
);
--> statement-breakpoint
CREATE TABLE "units" (
	"aggregate_path" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"id" text NOT NULL,
	"version" bigint NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"timezone" text NOT NULL,
	"archived_at" text,
	"agenda_mode" text NOT NULL,
	"fiscal_kind" text NOT NULL,
	"address" jsonb NOT NULL,
	"agenda" jsonb NOT NULL,
	"fiscal" jsonb NOT NULL,
	"public_visible" boolean,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "units_agenda_mode_check" CHECK ("units"."agenda_mode" IN ('fixed', 'always_open', 'appointment')),
	CONSTRAINT "units_fiscal_kind_check" CHECK ("units"."fiscal_kind" IN ('informal', 'company')),
	CONSTRAINT "units_name_nonempty" CHECK (char_length(btrim("units"."name")) > 0),
	CONSTRAINT "units_slug_nonempty" CHECK (char_length(btrim("units"."slug")) > 0),
	CONSTRAINT "units_timezone_nonempty" CHECK (char_length(btrim("units"."timezone")) > 0)
);
--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memberships_org_id_user_id_idx" ON "memberships" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_user_id_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "orgs_slug_idx" ON "orgs" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "units_org_id_name_idx" ON "units" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "units_org_id_slug_idx" ON "units" USING btree ("org_id","slug");