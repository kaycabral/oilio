// Idempotent reset of the local `oilio` event store before seeding.
//
// The event store is append-only with `UNIQUE(aggregate_type, org_id,
// aggregate_id, version)`: re-running the seed without a reset would raise 23505
// on the first `version=1` emit. So the seed TRUNCATEs every table first. This is
// a LOCAL DEV database — a disposable, re-seedable fixture, never production — so a
// full truncate is safe HERE, and it is hard-guarded to localhost (below) so it can
// never touch a remote/shared database. (This says nothing about prod: oilio runs in
// production; only THIS local fixture is truncatable. Audit #1383.)

import type { Pool } from 'pg'

// Refuse to truncate anything but a local database. The seed is a dev tool; a
// stray `OILIO_DATABASE_URL` pointing at a shared/remote instance must never be
// wiped. Accept only loopback hosts.
function assertLocalDatabase(): void {
  const url = process.env.OILIO_DATABASE_URL
  if (url === undefined || url === '') {
    throw new Error('OILIO_DATABASE_URL is not set; refusing to truncate.')
  }
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    throw new Error(`OILIO_DATABASE_URL is not a valid URL; refusing to truncate.`)
  }
  const localHosts = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0'])
  if (!localHosts.has(host)) {
    throw new Error(
      `Refusing to reset a non-local database (host: ${host}). ` +
        `The dev seed only truncates a localhost Postgres.`,
    )
  }
}

// Every base table in the public schema except drizzle's migration ledger —
// discovered from the catalog so a new aggregate table is covered automatically
// (no hand-maintained list to drift). `RESTART IDENTITY CASCADE` resets any
// serials and follows FKs, so order doesn't matter.
export async function resetEventStore(pool: Pool): Promise<void> {
  assertLocalDatabase()
  const { rows } = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables
     WHERE schemaname = 'public' AND tablename <> '__drizzle_migrations'`,
  )
  if (rows.length === 0) {
    throw new Error('No tables found to reset — did migrations run? (pnpm db:start)')
  }
  const tables = rows.map((r) => `"${r.tablename}"`).join(', ')
  await pool.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`)
}
