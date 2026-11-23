import { supabaseSsl } from '@cbrl/pg'
import { createDrizzleDatabase } from '@cbrl/pg/drizzle'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as schema from '../schema'

export const PRODUCT_MIGRATIONS_TABLE = '__drizzle_migrations_product'

export const productDb = createDrizzleDatabase({
  connectionStringEnvVar: 'DATABASE_URL',
  database: 'produtos',
  ssl: supabaseSsl,
  schema,
  migrationsFolder: path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../drizzle/product',
  ),
  migrationsTable: PRODUCT_MIGRATIONS_TABLE,
})

export function initProductDb(): void {
  productDb.pool()
}

export function getDb(): NodePgDatabase<typeof schema> {
  return productDb.db()
}

export async function closeDb(): Promise<void> {
  await productDb.close()
}

export async function runMigrations(connectionString?: string): Promise<void> {
  await productDb.migrate(connectionString === undefined ? {} : { connectionString })
}
