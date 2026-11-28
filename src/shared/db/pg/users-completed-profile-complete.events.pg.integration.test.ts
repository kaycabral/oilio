import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeEventStoreDb } from './pool'
import { ownerPool } from '@/shared/db/pg/test/owner-pool'

const CHECK_VIOLATION = '23514'
const CONSTRAINT = 'users_completed_profile_complete'
const TS = '2026-06-01T12:00:00.000Z'

let seq = 0
function uniqueUid(label: string): string {
  seq += 1
  return `u-${label}-${Date.now()}-${seq}`
}

async function insertUser(overrides: {
  uid: string
  completionCompleted?: boolean
  mobile?: string | null
  birthDate?: string | null
  claimedAt?: string | null
  anonymizedAt?: string | null
}): Promise<void> {
  await ownerPool().query(
    `INSERT INTO users
       (uid, email_verified, completion_completed, mobile, birth_date,
        claimed_at, anonymized_at, created_at, updated_at)
     VALUES ($1, false, $2, $3, $4, $5, $6, $7, $7)`,
    [
      overrides.uid,
      overrides.completionCompleted ?? false,
      overrides.mobile ?? null,
      overrides.birthDate ?? null,
      overrides.claimedAt ?? null,
      overrides.anonymizedAt ?? null,
      TS,
    ],
  )
}

describe('users_completed_profile_complete CHECK (brief 0077 AC-02)', () => {
  beforeEach(async () => {
    await ownerPool().query("DELETE FROM users WHERE uid LIKE 'u-%'")
  })

  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('rejects a completed user with no mobile/birth_date (23514)', async () => {
    const uid = uniqueUid('completed-incomplete')
    await expect(
      insertUser({
        uid,
        completionCompleted: true,
        claimedAt: TS,
        mobile: null,
        birthDate: null,
      }),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: CONSTRAINT })
  })

  it('rejects a completed user missing only mobile (23514)', async () => {
    const uid = uniqueUid('completed-no-whatsapp')
    await expect(
      insertUser({
        uid,
        completionCompleted: true,
        claimedAt: TS,
        mobile: null,
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
        mobile: '5511999990000',
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
        mobile: '5511999990001',
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
        mobile: null,
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
        mobile: null,
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
        mobile: null,
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
      mobile: '5511999990002',
      birthDate: '1990-01-01',
    })
    await expect(
      ownerPool().query('UPDATE users SET mobile = NULL WHERE uid = $1', [uid]),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: CONSTRAINT })
  })
})
