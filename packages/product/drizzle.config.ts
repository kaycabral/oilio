import { requireEnv } from '@cbrl/env'
import { defineConfig } from 'drizzle-kit'

/**
 * drizzle-kit config for the sovereign product base.
 *
 * `generate` produces versioned SQL migrations in `drizzle/` (reviewable in the
 * PR); `migrate` applies them. Migrations run in a dedicated Cloud Run Job, NEVER
 * at boot (N instances → advisory-lock race) and NEVER via `push` in prod (rename
 * becomes drop+add → data loss). See the ADR in apps/oilio/docs/decisions/.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url: requireEnv('DATABASE_URL') },
  strict: true,
  verbose: true,
})
