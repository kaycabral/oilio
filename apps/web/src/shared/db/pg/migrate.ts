import { migrate } from 'drizzle-orm/node-postgres/migrator'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getEventStoreDb } from './pool'

/**
 * Apply all versioned migrations in `drizzle/` against the connected oilio
 * event-store database.
 *
 * Used by the integration suite (to bring an ephemeral Postgres up to schema)
 * and by the Cloud Run migration Job in prod. NEVER call this at app boot
 * (ADR 0011 D2): with N instances the migrator advisory-lock races; the Job
 * serializes. NEVER use `drizzle-kit push` in prod (D3) — a rename becomes
 * drop+add and loses data.
 */
export async function runEventStoreMigrations(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const migrationsFolder = path.resolve(here, '../../../../drizzle')
  await migrate(getEventStoreDb(), { migrationsFolder })
}
