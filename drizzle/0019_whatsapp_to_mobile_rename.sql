-- Brief 0087: rename the person/contact `whatsapp` column to `mobile` on the
-- three PII-bearing tables, and enforce the strict Brazilian-mobile format at
-- the database (9th digit required). The WhatsApp *channel* (message templates,
-- wa.me, notification dispatch) is untouched — this is the stored NUMBER, not
-- the channel. `RENAME COLUMN` preserves every existing row's value in place, so
-- this needs no backfill REGARDLESS of how much data prod holds — the rename is
-- data-safe by construction. (An earlier version of this note leaned on "production
-- is empty" as the justification; that premise was both unnecessary here and stale
-- — oilio is in production. See audit #1383.)
--
-- RENAME COLUMN keeps the existing index/CHECK expressions valid (Postgres
-- rewrites the referenced column inside them automatically); only the
-- constraint/index NAMES need to follow, done explicitly below so they read as
-- `*_mobile_*`.

-- ── users ────────────────────────────────────────────────────────────────────
ALTER TABLE "users" RENAME COLUMN "whatsapp" TO "mobile";--> statement-breakpoint
ALTER INDEX "users_whatsapp_unique" RENAME TO "users_mobile_unique";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_anonymized_pii_scrubbed";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_anonymized_pii_scrubbed" CHECK ("users"."anonymized_at" IS NULL OR ("users"."mobile" IS NULL AND "users"."birth_date" IS NULL));--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_completed_profile_complete";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_completed_profile_complete" CHECK ("users"."completion_completed" = false OR "users"."anonymized_at" IS NOT NULL OR ("users"."mobile" IS NOT NULL AND char_length(btrim("users"."mobile")) > 0 AND "users"."birth_date" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_mobile_br_format" CHECK ("users"."mobile" IS NULL OR "users"."mobile" ~ '^55[0-9]{2}9[0-9]{8}$');--> statement-breakpoint

-- ── units_pii ────────────────────────────────────────────────────────────────
ALTER TABLE "units_pii" RENAME COLUMN "whatsapp" TO "mobile";--> statement-breakpoint
ALTER TABLE "units_pii" DROP CONSTRAINT IF EXISTS "units_pii_whatsapp_nonempty";--> statement-breakpoint
ALTER TABLE "units_pii" ADD CONSTRAINT "units_pii_mobile_nonempty" CHECK (char_length(btrim("units_pii"."mobile")) > 0);--> statement-breakpoint
ALTER TABLE "units_pii" ADD CONSTRAINT "units_pii_mobile_br_format" CHECK ("units_pii"."mobile" ~ '^55[0-9]{2}9[0-9]{8}$');--> statement-breakpoint

-- ── invites_pii ──────────────────────────────────────────────────────────────
ALTER TABLE "invites_pii" RENAME COLUMN "whatsapp" TO "mobile";--> statement-breakpoint
ALTER TABLE "invites_pii" DROP CONSTRAINT IF EXISTS "invites_pii_whatsapp_nonempty";--> statement-breakpoint
ALTER TABLE "invites_pii" ADD CONSTRAINT "invites_pii_mobile_nonempty" CHECK (char_length(btrim("invites_pii"."mobile")) > 0);--> statement-breakpoint
ALTER TABLE "invites_pii" ADD CONSTRAINT "invites_pii_mobile_br_format" CHECK ("invites_pii"."mobile" ~ '^55[0-9]{2}9[0-9]{8}$');
