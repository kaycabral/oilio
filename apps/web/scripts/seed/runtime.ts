// Seed runtime boot/teardown + the shared clock.
//
// The dev seed writes through the SAME canonical path as production —
// `emitEvent`/`commitSaga` over the Postgres event store — so it needs the
// event-store pool open and `OILIO_DATABASE_URL` pointing at a migrated `oilio`
// database (brought up by `scripts/oilio-db-up.mjs`). It does NOT mount a
// `SecurityContext`: the persistence layer derives the RLS GUC `app.current_org`
// from each write's `AggregateRef.orgId`, so the seed writes under RLS without a
// bypass (the app role has no BYPASSRLS).

import { closeEventStoreDb, getEventStorePool, initEventStore } from '@/shared/db/pg/pool'
import type { Pool } from 'pg'

// One frozen ISO clock for the whole run, so re-running the seed reproduces the
// exact same timestamps (idempotency) and every aggregate in a saga shares one
// `createdAt`. Date-relative scenarios (yesterday/today/tomorrow appointments)
// derive from this anchor via `daysFromNow`.
export const NOW = new Date('2026-06-26T12:00:00.000Z')
export const now = NOW.toISOString()

// An ISO timestamp `days` away from the seed anchor (negative = past). Keeps the
// agenda/appointment scenarios deterministic across runs.
export function daysFromNow(days: number, hour = 12): string {
  const d = new Date(NOW)
  d.setUTCDate(d.getUTCDate() + days)
  d.setUTCHours(hour, 0, 0, 0)
  return d.toISOString()
}

// Open the event-store pool (idempotent). In local/CI password mode the pool is
// lazy, but calling `initEventStore` fails fast on a missing/bad URL here rather
// than on the first emit deep inside a saga.
export async function bootSeed(): Promise<Pool> {
  if (typeof process.env.OILIO_DATABASE_URL !== 'string' || process.env.OILIO_DATABASE_URL === '') {
    throw new Error(
      'OILIO_DATABASE_URL is not set. Bring the local Postgres up first:\n' +
        '  pnpm --filter @oilio/web oilio:db:up\n' +
        'or run the whole flow via `pnpm local`.',
    )
  }
  await initEventStore()
  return getEventStorePool()
}

export async function shutdownSeed(): Promise<void> {
  await closeEventStoreDb()
}
