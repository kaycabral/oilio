-- Runtime role for the app: DML only, never the table owner and never
-- BYPASSRLS, so FORCE ROW LEVEL SECURITY binds every query the app runs. The
-- migrator (the role applying this file, `postgres` on Supabase) owns the
-- schema. Created NOLOGIN: the password is set once out-of-band
-- (docs/production.md) and never lives in a migration.
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
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO oilio_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO oilio_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO oilio_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO oilio_app;
--> statement-breakpoint
-- Supabase API roles. oilio never reads data through the Data API (PostgREST);
-- the app talks to Postgres directly as oilio_app. Several tables carry no RLS
-- by design (users, events, pii_events, ...), so the API roles must hold no
-- privilege at all in `public`, now or for tables created later. service_role
-- is included: the secret key only drives the Auth admin API, which runs as
-- supabase_auth_admin, so a leaked key still reads no app data. No-op on a
-- plain Postgres (local integration suites), where these roles do not exist.
DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', api_role);
      EXECUTE format('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM %I', api_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', api_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', api_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM %I', api_role);
    END IF;
  END LOOP;
END
$$;
