import { supabaseSsl } from '@cbrl/pg'
import { createDrizzleDatabase } from '@cbrl/pg/drizzle'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Pool } from 'pg'
import * as schema from './schema'

export const eventStore = createDrizzleDatabase({
  connectionStringEnvVar: 'OILIO_DATABASE_URL',
  database: 'oilio',
  ssl: supabaseSsl,
  schema,
  migrationsFolder: path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../drizzle',
  ),
})

export function initEventStore(): void {
  eventStore.pool()
}

export function getEventStorePool(): Pool {
  return eventStore.pool()
}

export function getEventStoreDb(): NodePgDatabase<typeof schema> {
  return eventStore.db()
}

export async function closeEventStoreDb(): Promise<void> {
  await eventStore.close()
}

export async function runEventStoreMigrations(connectionString?: string): Promise<void> {
  await eventStore.migrate(connectionString === undefined ? {} : { connectionString })
}
