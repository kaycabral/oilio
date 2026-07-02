import {
  closeManagedPool,
  getOrCreateManagedPoolSync,
  initManagedPool,
  type ManagedPool,
} from '@cbrl/db'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { Pool } from 'pg'
import * as schema from './schema'

/**
 * Postgres connection for the oilio relational event store (brief 0057).
 *
 * The instance `oilio-db` hosts two logical databases (PRD: "1 instância, 2
 * databases lógicos") — `produtos` (the sovereign base, `@cbrl/product`) and
 * `oilio` (the event store, this module). The connection policy (IAM in prod,
 * connection string locally/CI) lives in the shared `@cbrl/db` factory.
 *
 * Two init paths, so the IAM connector's async-ness never leaks into the ~270
 * synchronous domain/test call-sites:
 *
 *   - **Production (IAM):** the pool is opened ONCE at server boot via
 *     `initEventStore()` (called from `instrumentation.ts` `register()` and the
 *     migration entrypoint). Eager + fail-fast: a bad credential / network / IAM
 *     config fails at startup, not on a user's first request. The sync getters
 *     then return the already-open pool.
 *   - **Local / CI / tests (password):** no boot ceremony — the sync getters
 *     lazily build the plain-connection-string pool on first use (the factory's
 *     password mode is synchronous), so the existing call-sites are untouched.
 *
 * The pool state lives in the `@cbrl/db` process-wide `globalThis` registry, NOT
 * a module-level `let` — under the Next standalone build Turbopack duplicates
 * this module across the instrumentation entry and the route-handler entries,
 * so a module-level singleton splits in two: boot opens one, requests see the
 * other (undefined) and hit the sync throw. That was the prod signup 500. The
 * registry is keyed by database name and unique per process. See `@cbrl/db`.
 *
 * Post-cutover (#1202) Postgres is the only backend, so eager-in-prod is correct.
 */

const ENV_CONFIG = {
  connectionStringEnvVar: 'OILIO_DATABASE_URL',
  iamAuthEnvVar: 'OILIO_USE_IAM_AUTH',
  instanceEnvVar: 'OILIO_CLOUDSQL_INSTANCE',
  iamUserEnvVar: 'OILIO_IAM_DB_USER',
  database: 'oilio',
} as const

// Drizzle wrappers are stateless views over the underlying pool (no connection
// state of their own), so we cache one per pool instance — keyed by the pool so
// a pool swap (registry rebuild after close) transparently yields a fresh one.
const drizzleByPool = new WeakMap<Pool, NodePgDatabase<typeof schema>>()

function dbFor(managed: ManagedPool): NodePgDatabase<typeof schema> {
  const cached = drizzleByPool.get(managed.pool)
  if (cached) return cached
  const built = drizzle(managed.pool, { schema })
  drizzleByPool.set(managed.pool, built)
  return built
}

/**
 * Open the event-store pool at server boot (`instrumentation.ts` register) and
 * from the migration entrypoint, before any query. Required in IAM mode (the
 * connector is async); idempotent — a second call is a no-op.
 */
export async function initEventStore(): Promise<void> {
  await initManagedPool(ENV_CONFIG)
}

/**
 * The event-store `pg` pool. The Postgres persistence Layer drives raw SQL over a
 * checked-out client (BEGIN/COMMIT for the event+projection tx), so it needs the
 * pool, not the Drizzle wrapper.
 */
export function getEventStorePool(): Pool {
  return getOrCreateManagedPoolSync(ENV_CONFIG).pool
}

/** Drizzle client bound to the oilio event-store schema. */
export function getEventStoreDb(): NodePgDatabase<typeof schema> {
  return dbFor(getOrCreateManagedPoolSync(ENV_CONFIG))
}

/** Close the pool + connector (tests / graceful shutdown). No-op if never opened. */
export async function closeEventStoreDb(): Promise<void> {
  await closeManagedPool(ENV_CONFIG)
}
