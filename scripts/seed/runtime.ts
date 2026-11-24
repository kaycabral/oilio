// Seed runtime boot/teardown + the shared clock.
//
// The dev seed writes through the SAME canonical path as production —
// `emitEvent`/`commitSaga` over the Postgres event store — so it needs the
// event-store pool open on the migrated LOCAL Supabase stack (`db:start`); it
// connects as the `postgres` owner because the reset TRUNCATEs every table. It does NOT mount a
// `SecurityContext`: the persistence layer derives the RLS GUC `app.current_org`
// from each write's `AggregateRef.orgId`, so the seed writes under RLS without a
// bypass (the app role has no BYPASSRLS).

import { closeEventStoreDb, getEventStorePool, initEventStore } from '@/shared/db/pg/pool'
import type { Pool } from 'pg'

import { readLocalSupabase } from '../local-supabase'

// One frozen ISO clock for the whole run, captured ONCE at module load, so every
// aggregate in a saga shares one `createdAt` and the run is internally
// deterministic (no `Date.now()` drift between emits). Anchored to noon UTC of
// the REAL day (#B2): the demo/dev agenda is alive around "today" instead of
// frozen in a past date that leaves the current day empty. Re-running on the same
// day reproduces the same timestamps; a different day naturally shifts the
// scenarios forward — which is the point.
export const NOW = (() => {
  const d = new Date()
  d.setUTCHours(12, 0, 0, 0)
  return d
})()
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
export function bootSeed(): Pool {
  process.env.OILIO_DATABASE_URL = readLocalSupabase().ownerDbUrl
  initEventStore()
  return getEventStorePool()
}

export async function shutdownSeed(): Promise<void> {
  await closeEventStoreDb()
}
