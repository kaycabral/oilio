import { requireEnv } from '@cbrl/env'
import { defineConfig } from 'drizzle-kit'

/**
 * drizzle-kit config for the oilio relational event store (brief 0057).
 *
 * `generate` produces versioned SQL migrations in `drizzle/` (reviewable in the
 * PR); `migrate` applies them. Migrations run in a dedicated Cloud Run Job,
 * NEVER at boot (ADR 0011 D2 — N instances → advisory-lock race) and NEVER via
 * `push` in prod (D3 — rename becomes drop+add → data loss).
 *
 * Targets `OILIO_DATABASE_URL` (the `oilio` logical database), distinct from the
 * `@cbrl/product` `DATABASE_URL` (the `produtos` database) on the same instance.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/shared/db/pg/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url: requireEnv('OILIO_DATABASE_URL') },
  strict: true,
  verbose: true,
})
