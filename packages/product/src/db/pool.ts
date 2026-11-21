import { supabaseSsl } from '@cbrl/pg'
import { createDrizzleDatabase } from '@cbrl/pg/drizzle'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as schema from '../schema'

/**
 * Journal table for the product migrations. Product and the oilio event store
 * share one Supabase database, so each keeps its own journal under `drizzle`.
 */
export const PRODUCT_MIGRATIONS_TABLE = '__drizzle_migrations_product'

/**
 * Postgres connection for the sovereign product base.
 *
 * Shares the `@cbrl/pg` connection policy with the oilio event store: in
 * production both live in the same Supabase Postgres, reached over the pooler
 * with a password and TLS verified against the pinned Supabase root CA
 * (`supabaseSsl`); locally/CI/tests `DATABASE_URL` points at the ephemeral
 * Postgres and TLS is left to the URL.
 *
 * Pool state lives in the `@cbrl/pg` process-wide `globalThis` registry, NOT a
 * module-level `let`: the Next standalone build (Turbopack) duplicates this
 * module across the instrumentation entry and route entries, so a module-level
 * singleton would split — boot opens one, requests see the other.
 */
export const productDb = createDrizzleDatabase({
  connectionStringEnvVar: 'DATABASE_URL',
  database: 'produtos',
  ssl: supabaseSsl,
  schema,
  migrationsFolder: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle'),
  migrationsTable: PRODUCT_MIGRATIONS_TABLE,
})

/** Open the product-base pool at boot (fail-fast on a missing connection string). Idempotent. */
export function initProductDb(): void {
  productDb.pool()
}

/** Drizzle client bound to the product schema. */
export function getDb(): NodePgDatabase<typeof schema> {
  return productDb.db()
}

/** Close the pool (tests / graceful shutdown). No-op if never opened. */
export async function closeDb(): Promise<void> {
  await productDb.close()
}

/**
 * Apply all versioned migrations in `drizzle/`, on `connectionString` (a
 * dedicated pool, closed afterwards) or on the registered pool.
 *
 * Used by the integration suite and by the production migration job in CI.
 * NEVER call this at app boot: with N instances the migrator advisory-lock
 * races. NEVER use `drizzle-kit push` in prod — a rename becomes drop+add and
 * loses data. See the ADR in docs/decisions/.
 */
export async function runMigrations(connectionString?: string): Promise<void> {
  await productDb.migrate(connectionString === undefined ? {} : { connectionString })
}
