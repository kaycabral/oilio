CREATE TABLE "member_funnel_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "member_funnel_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"event" text NOT NULL,
	"org_id" text NOT NULL,
	"actor_id" text,
	"member_uid" text,
	"role" text,
	"ts" timestamp with time zone NOT NULL,
	CONSTRAINT "member_funnel_events_event_check" CHECK ("member_funnel_events"."event" IN (
        'member_invite_issued',
        'member_invite_opened',
        'member_invite_accepted'
      )),
	CONSTRAINT "member_funnel_events_role_check" CHECK ("member_funnel_events"."role" IS NULL OR "member_funnel_events"."role" IN ('owner', 'manager', 'member_operator', 'receptionist'))
);
--> statement-breakpoint
CREATE INDEX "member_funnel_events_org_id_ts_idx" ON "member_funnel_events" USING btree ("org_id","ts");--> statement-breakpoint
CREATE INDEX "member_funnel_events_event_ts_idx" ON "member_funnel_events" USING btree ("event","ts");