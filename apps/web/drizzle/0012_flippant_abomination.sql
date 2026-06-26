CREATE TABLE "invites_pii" (
	"aggregate_path" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"id" text NOT NULL,
	"email" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_templates" (
	"aggregate_path" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"type" text NOT NULL,
	"body" text,
	"enabled" boolean NOT NULL,
	"last_actor_uid" text,
	"updated_at" text NOT NULL,
	CONSTRAINT "message_templates_type_nonempty" CHECK (char_length(btrim("message_templates"."type")) > 0)
);
--> statement-breakpoint
CREATE TABLE "org_links" (
	"user_id" text NOT NULL,
	"org_id" text NOT NULL,
	"linked_at" text NOT NULL,
	CONSTRAINT "org_links_pkey" PRIMARY KEY("user_id","org_id")
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
CREATE TABLE "professionals_pii" (
	"aggregate_path" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"id" text NOT NULL,
	"tax_identity" jsonb
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
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unit_tax_identity" (
	"aggregate_path" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"id" text NOT NULL,
	"tax_identity" jsonb
);
--> statement-breakpoint
CREATE TABLE "units_pii" (
	"aggregate_path" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"id" text NOT NULL,
	"whatsapp" text NOT NULL,
	"email" text
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
	"claimed_at" text,
	"terms_accepted_at" text,
	"terms_version" text,
	"privacy_accepted_at" text,
	"privacy_version" text,
	"anonymized_at" text,
	"tax_identity" jsonb,
	"specialties" jsonb,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "users_anonymized_pii_scrubbed" CHECK ("users"."anonymized_at" IS NULL OR ("users"."whatsapp" IS NULL AND "users"."birth_date" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "invites_pii" ADD CONSTRAINT "invites_pii_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professionals_pii" ADD CONSTRAINT "professionals_pii_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_tax_identity" ADD CONSTRAINT "unit_tax_identity_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units_pii" ADD CONSTRAINT "units_pii_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invites_pii_org_id_idx" ON "invites_pii" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "message_templates_org_id_type_idx" ON "message_templates" USING btree ("org_id","type");--> statement-breakpoint
CREATE INDEX "org_links_user_id_idx" ON "org_links" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "pii_events_subject_ref_idx" ON "pii_events" USING btree ("subject_ref");--> statement-breakpoint
CREATE INDEX "pii_events_org_id_ts_idx" ON "pii_events" USING btree ("org_id","ts");--> statement-breakpoint
CREATE INDEX "product_events_gtin14_ts_idx" ON "product_events" USING btree ("gtin14","ts");--> statement-breakpoint
CREATE INDEX "product_events_event_ts_idx" ON "product_events" USING btree ("event","ts");--> statement-breakpoint
CREATE INDEX "professionals_pii_org_id_idx" ON "professionals_pii" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "public_org_directory_slug_idx" ON "public_org_directory" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "unit_tax_identity_org_id_idx" ON "unit_tax_identity" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "units_pii_org_id_idx" ON "units_pii" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════
-- Row-Level Security for the cutover tables (brief 0062, feature F).
--
-- The cutover separates THREE data natures that feature C/D/E had collapsed onto
-- one org-scoped policy (the "excellence" design — separation of concerns):
--
--   1. ORG-SCOPED operational/config data → `org_id = current_org` (unchanged).
--      Here: `message_templates`, plus the deletable PII sidecars `invites_pii`,
--      `professionals_pii`, `units_pii`, `unit_tax_identity` (org-only — a row is
--      visible/writable only under its owning org; deleting it erases the PII
--      while the projection + event history stay intact, ADR 0010 / LGPD).
--   2. PER-SUBJECT identity data → `user_id = current_user_id`. The reads precede
--      any org context ("which orgs am I a member of / a customer of?"), so an
--      org predicate would be wrong. Here: `org_links`, plus an ADDITIONAL
--      per-subject SELECT policy on `memberships` (its org-scoped policy from
--      0003_rls_identity stays — RLS PERMISSIVE policies OR together, so a row is
--      visible under EITHER the active org OR to its own subject).
--   3. PUBLIC-by-contract / global → NO RLS. `public_org_directory` (the pre-auth
--      slug→org resolution, public exactly as the booking page is); `users` (the
--      global identity record — no `org_id`, guarded at the request boundary by
--      Firebase Auth, read cross-org only for uids already authorized through an
--      org-scoped projection); `pii_events`/`product_events` (append-only
--      telemetry sinks, org-less/cross-org, best-effort).
--
-- `current_setting(..., true)` returns NULL when the GUC is unset → fail-closed
-- (zero rows). `FORCE ROW LEVEL SECURITY` applies the policy even to the table
-- owner (production runs as a non-owner role without BYPASSRLS).
-- ════════════════════════════════════════════════════════════════════════════

-- ── message_templates (org-only) ───────────────────────────────────────────────
ALTER TABLE "message_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "message_templates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "message_templates_org_isolation" ON "message_templates"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));--> statement-breakpoint

-- ── invites_pii (org-only PII sidecar) ─────────────────────────────────────────
ALTER TABLE "invites_pii" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invites_pii" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "invites_pii_org_isolation" ON "invites_pii"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));--> statement-breakpoint

-- ── professionals_pii (org-only PII sidecar) ───────────────────────────────────
ALTER TABLE "professionals_pii" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "professionals_pii" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "professionals_pii_org_isolation" ON "professionals_pii"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));--> statement-breakpoint

-- ── units_pii (org-only PII sidecar) ───────────────────────────────────────────
ALTER TABLE "units_pii" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "units_pii" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "units_pii_org_isolation" ON "units_pii"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));--> statement-breakpoint

-- ── unit_tax_identity (org-only fiscal-PII sidecar) ─────────────────────────────
ALTER TABLE "unit_tax_identity" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "unit_tax_identity" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "unit_tax_identity_org_isolation" ON "unit_tax_identity"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));--> statement-breakpoint

-- ── org_links (per-subject) ────────────────────────────────────────────────────
-- The identity reverse index: a subject reads ONLY their own links ("where am I
-- a customer?"). Server-only writes also scope to the subject.
ALTER TABLE "org_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "org_links" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_links_subject_isolation" ON "org_links"
  USING ("user_id" = current_setting('app.current_user_id', true))
  WITH CHECK ("user_id" = current_setting('app.current_user_id', true));--> statement-breakpoint

-- ── memberships (ADDITIONAL per-subject SELECT) ────────────────────────────────
-- Lets the "which orgs am I a member of?" read (login / org switcher) succeed
-- with NO active org — the subject sees their own membership rows. The existing
-- org-scoped policy (0003_rls_identity) is untouched; PERMISSIVE policies OR, so
-- operational org reads keep working AND a subject can list their own memberships.
CREATE POLICY "memberships_subject_select" ON "memberships"
  FOR SELECT
  USING ("user_id" = current_setting('app.current_user_id', true));
