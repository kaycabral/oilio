-- The product base is read and written at runtime by the oilio_app role (#80),
-- never by the owner. In production it shares the database with the event
-- store, whose migration 0023 already creates the role and the default
-- privileges; this journal can also land on a database of its own (integration
-- suites), so it creates the role the same way (idempotent, NOLOGIN, no
-- BYPASSRLS) and grants DML only.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oilio_app') THEN
    CREATE ROLE oilio_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO oilio_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "product" TO oilio_app;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
