import { createManagedPool, createManagedPoolSync, type ManagedPool } from '@cbrl/db'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from '../schema'

/**
 * Postgres connection for the sovereign product base.
 *
 * Shares the `@cbrl/db` connection policy with the oilio event store (same Cloud
 * SQL instance, 1 instance / 2 logical DBs): IAM auth in production (passwordless,
 * the connector dials the private IP over the VPC), plain connection string
 * (`DATABASE_URL`) locally/CI/tests.
 *
 * Two init paths so the IAM connector's async-ness never leaks into callers:
 * production opens the pool once at boot via `initProductDb()` (fail-fast); tests
 * /local lazily build the sync password-mode pool on first use. See the oilio
 * `pool.ts` for the full rationale.
 */

const ENV_CONFIG = {
  connectionStringEnvVar: 'DATABASE_URL',
  iamAuthEnvVar: 'PRODUCT_USE_IAM_AUTH',
  instanceEnvVar: 'PRODUCT_CLOUDSQL_INSTANCE',
  iamUserEnvVar: 'PRODUCT_IAM_DB_USER',
  database: 'produtos',
} as const

let managed: ManagedPool | undefined
let db: NodePgDatabase<typeof schema> | undefined

function adopt(m: ManagedPool): ManagedPool {
  managed = m
  db = drizzle(m.pool, { schema })
  return m
}

/** Open the product-base pool at boot (required in IAM mode). Idempotent. */
export async function initProductDb(): Promise<void> {
  if (managed === undefined) adopt(await createManagedPool(ENV_CONFIG))
}

function ensureManaged(): ManagedPool {
  return managed ?? adopt(createManagedPoolSync(ENV_CONFIG))
}

/** Drizzle client bound to the product schema. */
export function getDb(): NodePgDatabase<typeof schema> {
  ensureManaged()
  return db ?? drizzle(ensureManaged().pool, { schema })
}

/** Close the pool (tests / graceful shutdown). No-op if never opened. */
export async function closeDb(): Promise<void> {
  if (managed !== undefined) {
    await managed.close()
    managed = undefined
    db = undefined
  }
}
