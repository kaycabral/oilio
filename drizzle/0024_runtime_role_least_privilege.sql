-- Least privilege for the oilio_app runtime role (#80). The event logs are
-- append-only for the app: it inserts and reads, never rewrites history, so a
-- SQL injection or a buggy query running as oilio_app cannot edit or erase the
-- audit trail. Erasure (LGPD) deletes PII sidecars, never events. Only the
-- owner (migrations, local seed resets) keeps UPDATE/DELETE/TRUNCATE.
REVOKE UPDATE, DELETE, TRUNCATE ON "events", "pii_events", "product_events" FROM oilio_app;
--> statement-breakpoint
-- No role but the owner creates objects in `public` (the Postgres 15+ default,
-- made explicit so it holds on any instance the migrations land on).
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
