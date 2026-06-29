import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeEventStoreDb, getEventStorePool } from './pool'

/**
 * Complete-registration invariant on `users` against REAL Postgres (brief 0077
 * AC-02, #1274) — the DATABASE layer of the defesa-em-3-camadas. The
 * `users_completed_profile_complete` CHECK (migration 0009) refuses a COMPLETED
 * user (`completion_completed = true`) whose `whatsapp` or `birth_date` is null:
 * nobody finishes registration without them, so nobody who logged in lingers
 * *usable* with an incomplete profile.
 *
 * Keyed on `completion_completed`, NOT `claimed_at`: login (claimed) precedes the
 * completion form (brief Fluxo principal steps 4→5), so claimed-but-not-completed
 * is a legitimate transient that the CHECK must admit.
 *
 * Proven directly at the DB (raw INSERT/UPDATE on the event-store pool, no domain
 * decode in the middle) so the failure is the constraint, not the application:
 *   - completed + missing PII → rejected (SQLSTATE 23514, check_violation)
 *   - completed + complete    → accepted
 *   - claimed but NOT completed + missing PII → accepted (login→complete transient)
 *   - stub (not completed) + missing PII → accepted (recepcionista exemption)
 *   - completed + anonymized + null PII → accepted (LGPD scrub carve-out)
 *
 * Per-run-unique uids so cases never collide across a shared database.
 */

const CHECK_VIOLATION = '23514'
const CONSTRAINT = 'users_completed_profile_complete'
const TS = '2026-06-01T12:00:00.000Z'

let seq = 0
function uniqueUid(label: string): string {
  seq += 1
  return `u-${label}-${Date.now()}-${seq}`
}

// Minimal raw insert into `users`; overridable per case. Mirrors the table's
// NOT-NULL columns (email_verified / completion_completed / created_at /
// updated_at) and leaves the PII / completion / claim columns to the case.
async function insertUser(overrides: {
  uid: string
  completionCompleted?: boolean
  whatsapp?: string | null
  birthDate?: string | null
  claimedAt?: string | null
  anonymizedAt?: string | null
}): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO users
       (uid, email_verified, completion_completed, whatsapp, birth_date,
        claimed_at, anonymized_at, created_at, updated_at)
     VALUES ($1, false, $2, $3, $4, $5, $6, $7, $7)`,
    [
      overrides.uid,
      overrides.completionCompleted ?? false,
      overrides.whatsapp ?? null,
      overrides.birthDate ?? null,
      overrides.claimedAt ?? null,
      overrides.anonymizedAt ?? null,
      TS,
    ],
  )
}

describe('users_completed_profile_complete CHECK (brief 0077 AC-02)', () => {
  beforeEach(async () => {
    // Clean only the rows this file makes (per-run-unique uids), keeping the
    // shared DB intact for sibling suites.
    await getEventStorePool().query("DELETE FROM users WHERE uid LIKE 'u-%'")
  })

  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('rejects a completed user with no whatsapp/birth_date (23514)', async () => {
    const uid = uniqueUid('completed-incomplete')
    await expect(
      insertUser({
        uid,
        completionCompleted: true,
        claimedAt: TS,
        whatsapp: null,
        birthDate: null,
      }),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: CONSTRAINT })
  })

  it('rejects a completed user missing only whatsapp (23514)', async () => {
    const uid = uniqueUid('completed-no-whatsapp')
    await expect(
      insertUser({
        uid,
        completionCompleted: true,
        claimedAt: TS,
        whatsapp: null,
        birthDate: '1990-01-01',
      }),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: CONSTRAINT })
  })

  it('rejects a completed user missing only birth_date (23514)', async () => {
    const uid = uniqueUid('completed-no-birth')
    await expect(
      insertUser({
        uid,
        completionCompleted: true,
        claimedAt: TS,
        whatsapp: '5511999990000',
        birthDate: null,
      }),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: CONSTRAINT })
  })

  it('accepts a completed user with complete profile', async () => {
    const uid = uniqueUid('completed-complete')
    await expect(
      insertUser({
        uid,
        completionCompleted: true,
        claimedAt: TS,
        whatsapp: '5511999990001',
        birthDate: '1990-01-01',
      }),
    ).resolves.toBeUndefined()
  })

  it('accepts a claimed-but-not-completed user with no PII (login→complete transient)', async () => {
    const uid = uniqueUid('claimed-pending')
    await expect(
      insertUser({
        uid,
        completionCompleted: false,
        claimedAt: TS,
        whatsapp: null,
        birthDate: null,
      }),
    ).resolves.toBeUndefined()
  })

  it('accepts an unclaimed stub with no PII (recepcionista exemption)', async () => {
    const uid = uniqueUid('stub')
    await expect(
      insertUser({
        uid,
        completionCompleted: false,
        claimedAt: null,
        whatsapp: null,
        birthDate: null,
      }),
    ).resolves.toBeUndefined()
  })

  it('accepts a completed + anonymized user with scrubbed PII (LGPD carve-out)', async () => {
    const uid = uniqueUid('anonymized')
    await expect(
      insertUser({
        uid,
        completionCompleted: true,
        claimedAt: TS,
        anonymizedAt: TS,
        whatsapp: null,
        birthDate: null,
      }),
    ).resolves.toBeUndefined()
  })

  it('rejects a completed user that becomes incomplete via UPDATE (23514)', async () => {
    const uid = uniqueUid('completed-then-cleared')
    await insertUser({
      uid,
      completionCompleted: true,
      claimedAt: TS,
      whatsapp: '5511999990002',
      birthDate: '1990-01-01',
    })
    await expect(
      getEventStorePool().query('UPDATE users SET whatsapp = NULL WHERE uid = $1', [uid]),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: CONSTRAINT })
  })
})
