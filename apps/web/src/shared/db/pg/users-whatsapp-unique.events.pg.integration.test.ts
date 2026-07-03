import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeEventStoreDb, getEventStorePool } from './pool'

/**
 * Global WhatsApp uniqueness on `users` against REAL Postgres — the DATABASE
 * wall of the one-owner-per-number rule. A phone number has exactly one owner and
 * the User is global (org/unit/role-agnostic), so the same `whatsapp` can never
 * back two Users. Enforced by the partial unique index `users_mobile_unique`
 * (migration 0012), `WHERE mobile IS NOT NULL` — multiple NULLs (stubs /
 * anonymized accounts) coexist because absence-of-datum is not a colliding value.
 *
 * Proven directly at the DB (raw INSERT/UPDATE on the event-store pool, no domain
 * decode in the middle) so the failure is the constraint, not the application:
 *   - two users, same non-null whatsapp → rejected (SQLSTATE 23505, unique_violation)
 *   - second user takes the number via UPDATE → rejected
 *   - two users, both NULL whatsapp        → accepted (partial index skips NULLs)
 *   - distinct numbers                     → accepted
 *
 * Per-run-unique uids + numbers so cases never collide across a shared database.
 */

const UNIQUE_VIOLATION = '23505'
const CONSTRAINT = 'users_mobile_unique'
const TS = '2026-06-01T12:00:00.000Z'

let seq = 0
function uniqueUid(label: string): string {
  seq += 1
  return `u-wa-${label}-${Date.now()}-${seq}`
}
// A distinct, well-formed BR mobile number per call so cases don't collide with
// each other (the whole point under test is that collisions are refused).
function uniqueWa(): string {
  seq += 1
  return `5511${String(910000000 + seq).padStart(9, '0')}`
}

// Minimal raw insert of a COMPLETE user (whatsapp + birth_date present so the
// sibling `users_completed_profile_complete` CHECK is satisfied), so this suite
// isolates the unique index. `completion_completed` defaults false (no CHECK in
// play); pass a whatsapp to exercise the index.
async function insertUser(uid: string, mobile: string | null): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO users
       (uid, email_verified, completion_completed, mobile, created_at, updated_at)
     VALUES ($1, false, false, $2, $3, $3)`,
    [uid, mobile, TS],
  )
}

describe('users_mobile_unique (global one-owner-per-number)', () => {
  beforeEach(async () => {
    // Clean only the rows this file makes (per-run-unique uids), keeping the
    // shared DB intact for sibling suites.
    await getEventStorePool().query("DELETE FROM users WHERE uid LIKE 'u-wa-%'")
  })

  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('rejects two users with the same whatsapp (23505)', async () => {
    const wa = uniqueWa()
    await insertUser(uniqueUid('first'), wa)
    await expect(insertUser(uniqueUid('second'), wa)).rejects.toMatchObject({
      code: UNIQUE_VIOLATION,
      constraint: CONSTRAINT,
    })
  })

  it('rejects a second user that takes an existing number via UPDATE (23505)', async () => {
    const wa = uniqueWa()
    await insertUser(uniqueUid('owner'), wa)
    const otherUid = uniqueUid('claimant')
    await insertUser(otherUid, uniqueWa())
    await expect(
      getEventStorePool().query('UPDATE users SET mobile = $1 WHERE uid = $2', [wa, otherUid]),
    ).rejects.toMatchObject({ code: UNIQUE_VIOLATION, constraint: CONSTRAINT })
  })

  it('accepts multiple users with NULL whatsapp (partial index skips NULLs)', async () => {
    await insertUser(uniqueUid('null-a'), null)
    await expect(insertUser(uniqueUid('null-b'), null)).resolves.toBeUndefined()
  })

  it('accepts users with distinct whatsapp numbers', async () => {
    await insertUser(uniqueUid('distinct-a'), uniqueWa())
    await expect(insertUser(uniqueUid('distinct-b'), uniqueWa())).resolves.toBeUndefined()
  })
})
