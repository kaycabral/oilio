import { migrate } from 'drizzle-orm/node-postgres/migrator'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDb } from './pool'

/**
 * Apply all versioned migrations in `drizzle/` against the connected database.
 *
 * Used by the integration suite (to bring an ephemeral Postgres up to schema) and
 * by the Cloud Run migration Job in prod. NEVER call this at app boot: with N
 * instances the migrator advisory-lock races. NEVER use `drizzle-kit push` in
 * prod — a rename becomes drop+add and loses data. See the ADR in
 * docs/decisions/.
 */
export async function runMigrations(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const migrationsFolder = path.resolve(here, '../../drizzle')
  await migrate(getDb(), { migrationsFolder })
}
