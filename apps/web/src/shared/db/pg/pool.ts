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
import * as schema from './schema'

export const EVENT_STORE_POOL_CONFIG: PoolEnvConfig = {
  connectionStringEnvVar: 'OILIO_DATABASE_URL',
  database: 'oilio',
  passwordModeSsl: supabaseSsl,
}

const drizzleByPool = new WeakMap<Pool, NodePgDatabase<typeof schema>>()

function dbFor(managed: ManagedPool): NodePgDatabase<typeof schema> {
  const cached = drizzleByPool.get(managed.pool)
  if (cached) return cached
  const built = drizzle(managed.pool, { schema })
  drizzleByPool.set(managed.pool, built)
  return built
}

export async function initEventStore(): Promise<void> {
  await initManagedPool(EVENT_STORE_POOL_CONFIG)
}

export function getEventStorePool(): Pool {
  return getOrCreateManagedPoolSync(EVENT_STORE_POOL_CONFIG).pool
}

export function getEventStoreDb(): NodePgDatabase<typeof schema> {
  return dbFor(getOrCreateManagedPoolSync(EVENT_STORE_POOL_CONFIG))
}

export async function closeEventStoreDb(): Promise<void> {
  await closeManagedPool(EVENT_STORE_POOL_CONFIG)
}
