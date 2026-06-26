import { requireEnv } from '@cbrl/env'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from '../schema'

/**
 * Postgres connection for the sovereign product base.
 *
 * Lazy + small: the pool is created on first use (not at import) so importing the
 * package — e.g. just the pure GTIN validator — never opens a socket. `max: 5`
 * keeps a serverless instance from exhausting Cloud SQL connections; a pooler
 * (PgBouncer / Cloud SQL) goes in front when instance count grows, at which point
 * prepared statements must be disabled (transaction-mode pooling). Connection
 * target is `DATABASE_URL` via `@cbrl/env` — fail-fast, no silent default.
 */

let pool: Pool | undefined
let db: NodePgDatabase<typeof schema> | undefined

function getPool(): Pool {
  if (pool === undefined) {
    pool = new Pool({
      connectionString: requireEnv('DATABASE_URL'),
      max: 5,
      // 10 min idle before a connection is released
      idleTimeoutMillis: 600_000,
    })
  }
  return pool
}

/** Lazily-created Drizzle client bound to the product schema. */
export function getDb(): NodePgDatabase<typeof schema> {
  if (db === undefined) {
    db = drizzle(getPool(), { schema })
  }
  return db
}

/** Close the pool (tests / graceful shutdown). No-op if never opened. */
export async function closeDb(): Promise<void> {
  if (pool !== undefined) {
    await pool.end()
    pool = undefined
    db = undefined
  }
}
