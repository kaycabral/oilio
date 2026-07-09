import {
  closeManagedPool,
  getOrCreateManagedPoolSync,
  initManagedPool,
  type ManagedPool,
} from '@cbrl/db'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { Pool } from 'pg'
import * as schema from './schema'

const ENV_CONFIG = {
  connectionStringEnvVar: 'OILIO_DATABASE_URL',
  iamAuthEnvVar: 'OILIO_USE_IAM_AUTH',
  instanceEnvVar: 'OILIO_CLOUDSQL_INSTANCE',
  iamUserEnvVar: 'OILIO_IAM_DB_USER',
  database: 'oilio',
} as const

const drizzleByPool = new WeakMap<Pool, NodePgDatabase<typeof schema>>()

function dbFor(managed: ManagedPool): NodePgDatabase<typeof schema> {
  const cached = drizzleByPool.get(managed.pool)
  if (cached) return cached
  const built = drizzle(managed.pool, { schema })
  drizzleByPool.set(managed.pool, built)
  return built
}

export async function initEventStore(): Promise<void> {
  await initManagedPool(ENV_CONFIG)
}

export function getEventStorePool(): Pool {
  return getOrCreateManagedPoolSync(ENV_CONFIG).pool
}

export function getEventStoreDb(): NodePgDatabase<typeof schema> {
  return dbFor(getOrCreateManagedPoolSync(ENV_CONFIG))
}

export async function closeEventStoreDb(): Promise<void> {
  await closeManagedPool(ENV_CONFIG)
}
