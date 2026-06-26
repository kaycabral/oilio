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
CREATE TABLE "projections" (
	"aggregate_path" text PRIMARY KEY NOT NULL,
	"state" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "events_aggregate_id_version_idx" ON "events" USING btree ("aggregate_id","version");--> statement-breakpoint
CREATE INDEX "events_org_id_idx" ON "events" USING btree ("org_id","aggregate_type","version");