import { getEventStorePool } from '@/shared/db/pg/pool'

// Serializes concurrent `createOrg` calls for the SAME user behind a Postgres
// advisory lock (brief 0088 AC-10 / H2). The 2º-Negócio gate is a read-then-write
// ("count owner-memberships, then insert") — under a connection pool at READ
// COMMITTED two concurrent double-submits both read `hasPaid=false`, both pass,
// and both create a Negócio (no UNIQUE collision to stop them: `orgs.id`/event
// `(aggregate_id,version)` differ per org). This is a TOCTOU race the plain guard
// can't close.
//
// The transactional wall: take a per-user advisory lock, and do the re-count +
// the whole commit INSIDE it. The second submit blocks until the first releases,
// then its re-count sees the just-created org and is refused. A session-level
// `pg_advisory_lock` (not `xact`) is used because the commit runs in its own
// transaction (via `commitSaga`), separate from this lock-holding connection —
// so the lock must outlive any single tx and is released explicitly in `finally`.
//
// `hashtext(userId)` maps the id to the `bigint` key the advisory-lock API takes.
// A legitimate 2º Negócio (the user already has a PAID one) still passes — the
// lock only serializes; the re-count is what enforces the rule.
export async function withUserOnboardingLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const client = await getEventStorePool().connect()
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [userId])
    return await fn()
  } finally {
    // Release before returning the connection to the pool — a leaked session
    // lock would wedge every future onboarding for this user on the reused
    // connection.
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', [userId])
    client.release()
  }
}
