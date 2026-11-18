import {
  closeManagedPool,
  getOrCreateManagedPoolSync,
  initManagedPool,
  type ManagedPool,
  type PoolEnvConfig,
} from '@cbrl/pg'
import { cloudSqlIam } from '@cbrl/pg/cloud-sql'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { Pool } from 'pg'
import * as schema from '../schema'

/**
 * Postgres connection for the sovereign product base.
 *
 * Shares the `@cbrl/pg` connection policy with the oilio event store (same Cloud
 * SQL instance, 1 instance / 2 logical DBs): IAM auth in production (passwordless,
 * the connector dials the private IP over the VPC), plain connection string
 * (`DATABASE_URL`) locally/CI/tests.
 *
 * Two init paths so the IAM connector's async-ness never leaks into callers:
 * production opens the pool once at boot via `initProductDb()` (fail-fast); tests
 * /local lazily build the sync password-mode pool on first use. See the oilio
 * `pool.ts` for the full rationale.
 *
 * Pool state lives in the `@cbrl/pg` process-wide `globalThis` registry, NOT a
 * module-level `let`: the Next standalone build (Turbopack) duplicates this
 * module across the instrumentation entry and route entries, so a module-level
 * singleton would split — boot opens one, requests see the other. The registry
 * is a true per-process singleton keyed by database name. See `@cbrl/pg`.
 */

export const PRODUCT_POOL_CONFIG: PoolEnvConfig = {
  connectionStringEnvVar: 'DATABASE_URL',
  database: 'produtos',
  iam: cloudSqlIam({
    enabledEnvVar: 'PRODUCT_USE_IAM_AUTH',
    instanceEnvVar: 'PRODUCT_CLOUDSQL_INSTANCE',
    userEnvVar: 'PRODUCT_IAM_DB_USER',
  }),
}

// Drizzle wrappers are stateless views over the pool, cached per pool instance.
const drizzleByPool = new WeakMap<Pool, NodePgDatabase<typeof schema>>()

function dbFor(managed: ManagedPool): NodePgDatabase<typeof schema> {
  const cached = drizzleByPool.get(managed.pool)
  if (cached) return cached
  const built = drizzle(managed.pool, { schema })
  drizzleByPool.set(managed.pool, built)
  return built
}

/** Open the product-base pool at boot (required in IAM mode). Idempotent. */
export async function initProductDb(): Promise<void> {
  await initManagedPool(PRODUCT_POOL_CONFIG)
}

/** Drizzle client bound to the product schema. */
export function getDb(): NodePgDatabase<typeof schema> {
  return dbFor(getOrCreateManagedPoolSync(PRODUCT_POOL_CONFIG))
}

/** Close the pool (tests / graceful shutdown). No-op if never opened. */
export async function closeDb(): Promise<void> {
  await closeManagedPool(PRODUCT_POOL_CONFIG)
}
