import { isUniqueViolation, USERS_MOBILE_UNIQUE } from '@/shared/db/pg/pg-error'
import { closeEventStoreDb, getEventStorePool } from '@/shared/db/pg/pool'
import { getUserById, patchUser, putUser } from '@/shared/db/pg/users-store'
import { buildUser } from '@/shared/fixtures/domain-builders'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

const TS = '2026-06-01T12:00:00.000Z'
const SHARED_MOBILE = '5511988887777'

let seq = 0
function uniqueUid(label: string): string {
  seq += 1
  return `u-${label}-${Date.now()}-${seq}`
}

describe('no stub merge by WhatsApp on profile completion (brief 0077, #1276)', () => {
  beforeEach(async () => {
    await getEventStorePool().query("DELETE FROM users WHERE uid LIKE 'u-%'")
  })

  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('refuses completing with an already-used WhatsApp and leaves the other user untouched', async () => {
    const existingUid = uniqueUid('existing')
    await putUser(
      buildUser(existingUid, TS, {
        mobile: SHARED_MOBILE,
        birthDate: '1985-05-05',
        completionCompleted: true,
        claimedAt: TS,
        displayName: 'Existing Person',
      }),
    )

    const claimerUid = uniqueUid('claimer')
    await putUser(
      buildUser(claimerUid, TS, {
        mobile: null,
        birthDate: null,
        completionCompleted: false,
        claimedAt: TS,
        displayName: 'New Login',
      }),
    )
    let refused = false
    try {
      await patchUser(
        claimerUid,
        {
          display_name: 'New Login',
          mobile: SHARED_MOBILE,
          birth_date: '1992-02-02',
          completion_completed: true,
        },
        new Date().toISOString(),
      )
    } catch (err) {
      refused = isUniqueViolation(err, USERS_MOBILE_UNIQUE)
      if (!refused) throw err
    }
    expect(refused).toBe(true)

    const existing = await getUserById(existingUid)
    expect(existing).not.toBeNull()
    expect(existing?.displayName).toBe('Existing Person')
    expect(existing?.mobile).toBe(SHARED_MOBILE)
    expect(existing?.birthDate).toBe('1985-05-05')

    const claimer = await getUserById(claimerUid)
    expect(claimer?.uid).toBe(claimerUid)
    expect(claimer?.completionCompleted).toBe(false)
    expect(claimer?.mobile).toBeNull()

    const owners = await getEventStorePool().query<{ uid: string }>(
      'SELECT uid FROM users WHERE mobile = $1',
      [SHARED_MOBILE],
    )
    expect(owners.rows.map((r) => r.uid)).toEqual([existingUid])
  })

  it('rejects a non-strict-mobile number at the DB (users_mobile_br_format CHECK)', async () => {
    const uid = uniqueUid('landline')
    let refused = false
    try {
      await putUser(buildUser(uid, TS, { mobile: '551133334444', displayName: 'Landline' }))
    } catch (err) {
      refused = /users_mobile_br_format/.test(String(err))
      if (!refused) throw err
    }
    expect(refused).toBe(true)

    const rows = await getEventStorePool().query('SELECT uid FROM users WHERE uid = $1', [uid])
    expect(rows.rowCount).toBe(0)
  })
})
