import {
  closeManagedPool,
  getOrCreateManagedPoolSync,
  initManagedPool,
  type ManagedPool,
  type PoolEnvConfig,
  supabaseSsl,
} from '@cbrl/pg'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { Pool } from 'pg'
import * as schema from '../schema'

/**
 * Postgres connection for the sovereign product base.
 *
 * Shares the `@cbrl/pg` connection policy with the oilio event store: in
 * production both live in the same Supabase Postgres, reached over the pooler
 * with a password and TLS verified against the pinned Supabase root CA
 * (`supabaseSsl`); locally/CI/tests `DATABASE_URL` points at the ephemeral
 * Postgres and TLS is left to the URL.
 *
 * Production opens the pool once at boot via `initProductDb()` (fail-fast);
 * tests/local lazily build it on first use.
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
  passwordModeSsl: supabaseSsl,
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

/** Open the product-base pool at boot (fail-fast on a bad connection string). Idempotent. */
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
