import { requireEnv } from '@cbrl/env'
import { defineConfig } from 'drizzle-kit'

/**
 * drizzle-kit config for the sovereign product base.
 *
 * `generate` produces versioned SQL migrations in `drizzle/` (reviewable in the
 * PR); `migrate` applies them. Production migrations run only from the CI job
 * `Deploy (migrate database)`, NEVER at boot (N instances → advisory-lock race) and
 * NEVER via `push` (rename becomes drop+add → data loss). The journal lives in
 * its own table because product shares the Supabase database with the event
 * store. See docs/production.md.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  migrations: { table: '__drizzle_migrations_product', schema: 'drizzle' },
  dbCredentials: { url: requireEnv('DATABASE_URL') },
  strict: true,
  verbose: true,
})
