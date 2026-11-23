-- ════════════════════════════════════════════════════════════════════════════
-- Customer-acquisition funnel telemetry (brief 0077 Grupo D — AC-12, #1279/#1280).
--
-- The funnel: invite issued → opened → signed in → profile completed →
-- appointment created. PII-ZERO by construction (the parede PII↔analytics): every
-- column is an opaque id (org/unit/actor/customer) or an attribution axis — never
-- a name/phone/email. The transport brief 0026's vendor-neutral `track()`
-- describes: an append-only table now, one adapter behind `track()` later.
--
-- NO Row-Level Security (like `product_events`): analytics read across orgs by the
-- aggregation/CDP layer, never by an org-scoped product query. `org_id` is an
-- attribution dimension here, not an isolation boundary.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE "client_funnel_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "client_funnel_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"event" text NOT NULL,
	"org_id" text NOT NULL,
	"unit_id" text,
	"actor_id" text,
	"customer_id" text,
	"intent" text,
	"source" text,
	"medium" text,
	"campaign" text,
	"from_invite" text,
	"fields_filled" jsonb,
	"ts" timestamp with time zone NOT NULL,
	CONSTRAINT "client_funnel_events_event_check" CHECK ("client_funnel_events"."event" IN (
        'client_invite_issued',
        'client_invite_opened',
        'client_signed_in',
        'client_profile_completed',
        'appointment_created'
      )),
	CONSTRAINT "client_funnel_events_intent_check" CHECK ("client_funnel_events"."intent" IS NULL OR "client_funnel_events"."intent" IN ('signup', 'booking'))
);
--> statement-breakpoint
CREATE INDEX "client_funnel_events_org_id_ts_idx" ON "client_funnel_events" USING btree ("org_id","ts");--> statement-breakpoint
CREATE INDEX "client_funnel_events_event_ts_idx" ON "client_funnel_events" USING btree ("event","ts");