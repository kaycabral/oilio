import { requireEnv } from '@cbrl/env'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

/**
 * Postgres connection for the oilio relational event store (brief 0057).
 *
 * The instance `oilio-db` hosts two logical databases (PRD: "1 instância, 2
 * databases lógicos") — `produtos` (the sovereign base, `@cbrl/product`, read
 * via `DATABASE_URL`) and `oilio` (the event store, read via the dedicated
 * `OILIO_DATABASE_URL`). The two connection strings are kept distinct so a
 * process touching both never routes one to the other.
 *
 * Lazy + small (ADR 0011 D4): the pool is created on first use (not at import)
 * so importing the module never opens a socket when the Firestore layer is the
 * active persistence (the default flag). `max: 5` keeps a serverless instance
 * from exhausting Cloud SQL connections; a pooler goes in front when instance
 * count grows, at which point prepared statements must be disabled.
 */

let pool: Pool | undefined
let db: NodePgDatabase<typeof schema> | undefined

function getPool(): Pool {
  if (pool === undefined) {
    pool = new Pool({
      connectionString: requireEnv('OILIO_DATABASE_URL'),
      max: 5,
      // 10 min idle before a connection is released.
      idleTimeoutMillis: 600_000,
    })
  }
  return pool
}

/** Lazily-created Drizzle client bound to the oilio event-store schema. */
export function getEventStoreDb(): NodePgDatabase<typeof schema> {
  if (db === undefined) {
    db = drizzle(getPool(), { schema })
  }
  return db
}

/**
 * The lazily-created `pg` pool itself. The Postgres persistence Layer drives raw
 * SQL over a checked-out client (BEGIN/COMMIT for the event+projection tx), so it
 * needs the pool, not the Drizzle wrapper.
 */
export function getEventStorePool(): Pool {
  return getPool()
}

/** Close the pool (tests / graceful shutdown). No-op if never opened. */
export async function closeEventStoreDb(): Promise<void> {
  if (pool !== undefined) {
    await pool.end()
    pool = undefined
    db = undefined
  }
}
