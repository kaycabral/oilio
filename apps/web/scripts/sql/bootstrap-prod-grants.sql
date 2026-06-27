-- Bootstrap the least-privilege Postgres grants for the oilio production database.
--
-- WHY THIS EXISTS (and is not a one-off psql someone typed once): the migrate and
-- the app runtime authenticate to Cloud SQL as DISTINCT IAM service-account users,
-- with DIFFERENT privilege needs. Encoding the regime here makes it reproducible —
-- recreating the instance, a DR rebuild, or a new environment re-applies the SAME
-- grants instead of rediscovering them via a failed deploy (the 42501 that blocked
-- oilio-v0.11.2: the migrator's `CREATE SCHEMA "drizzle"` was denied).
--
-- TWO ROLES, LEAST PRIVILEGE:
--   • MIGRATOR (oilio-migrator@…iam) — runs `migrate:oilio` (drizzle-orm migrator).
--     Needs DDL: CREATE on the database (for the `drizzle` bookkeeping schema) and
--     on `public` (for CREATE TABLE/ALTER). Owns the objects it creates.
--   • APP (238073251489-compute@developer) — the Cloud Run SERVICE runtime. Needs
--     only DML (SELECT/INSERT/UPDATE/DELETE). MUST NOT hold CREATE — the app server
--     has no business altering schema; that authority lives only in the migrator.
--
-- Run ONCE as a superuser/owner (the Cloud SQL `postgres` built-in) against the
-- `oilio` database. Idempotent: re-running is a no-op. Cloud SQL IAM users are
-- named WITHOUT the `.gserviceaccount.com` suffix.
--
--   PGPASSWORD=… psql "host=127.0.0.1 user=postgres dbname=oilio" \
--     -v ON_ERROR_STOP=1 -f apps/oilio/web/scripts/sql/bootstrap-prod-grants.sql

\set migrator '"oilio-migrator@cbrl-oilio-production.iam"'
\set app      '"238073251489-compute@developer"'

-- NOTE: no explicit BEGIN/COMMIT. `gcloud sql import sql` already runs the file in
-- a transaction (an inner BEGIN warns "transaction already in progress" and a
-- failed COMMIT silently drops earlier statements). Run under psql interactively
-- and it autocommits per statement — also fine, since every statement here is
-- independently idempotent.

-- Lock down the database: no implicit privileges via PUBLIC. Grants below are the
-- ONLY access. (REVOKE FROM PUBLIC is idempotent.)
REVOKE ALL ON DATABASE oilio FROM PUBLIC;

-- ── Migrator: DDL ───────────────────────────────────────────────────────────
-- CREATE on the database lets the drizzle migrator create its `drizzle` schema;
-- CREATE on `public` lets migrations create/alter the projection + event tables.
GRANT CONNECT, CREATE ON DATABASE oilio TO :migrator;
GRANT USAGE, CREATE ON SCHEMA public   TO :migrator;

-- ── App runtime: DML only ───────────────────────────────────────────────────
GRANT CONNECT ON DATABASE oilio TO :app;
GRANT USAGE   ON SCHEMA public  TO :app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO :app;
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA public TO :app;

-- ── Default privileges: bridge the ownership gap ────────────────────────────
-- The migrator OWNS every table it creates. Without this, the app (a different
-- role) could not read a freshly-migrated table — the classic "permission denied
-- for relation" after a clean migration. ALTER DEFAULT PRIVILEGES FOR ROLE
-- <migrator> makes every future object the migrator creates in `public` carry the
-- app's DML grant automatically. Idempotent.
--
-- `ALTER DEFAULT PRIVILEGES FOR ROLE x` requires the executor to be a MEMBER of x
-- (Postgres rule). Cloud SQL's `postgres` is NOT a full superuser (member of
-- `cloudsqlsuperuser`, no implicit SET ROLE), so it must first join the migrator
-- role. Grant membership, set the default privileges, then drop membership so
-- `postgres` does not retain the migrator's rights beyond bootstrap. Idempotent.
GRANT :migrator TO CURRENT_USER;
ALTER DEFAULT PRIVILEGES FOR ROLE :migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :app;
ALTER DEFAULT PRIVILEGES FOR ROLE :migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :app;
REVOKE :migrator FROM CURRENT_USER;
