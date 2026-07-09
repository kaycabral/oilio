import { migrate } from 'drizzle-orm/node-postgres/migrator'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getEventStoreDb } from './pool'

export async function runEventStoreMigrations(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const migrationsFolder = path.resolve(here, '../../../../drizzle')
  await migrate(getEventStoreDb(), { migrationsFolder })
}
