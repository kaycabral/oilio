import { requireEnv } from '@cbrl/env'
import { defineConfig } from 'drizzle-kit'

/**
 * drizzle-kit config for the oilio relational event store (brief 0057).
 *
 * `generate` produces versioned SQL migrations in `drizzle/` (reviewable in the
 * PR); `migrate` applies them. Production migrations run only from the CI job
 * `migrate-production`, NEVER at boot (ADR 0011 D2 — N instances →
 * advisory-lock race) and NEVER via `push` (D3 — rename becomes drop+add → data
 * loss). See docs/production.md.
 *
 * Targets `OILIO_DATABASE_URL`. In production it is the Supabase session pooler
 * as the `postgres` owner role; the app itself connects as `oilio_app`.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/shared/db/pg/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url: requireEnv('OILIO_DATABASE_URL') },
  strict: true,
  verbose: true,
})
