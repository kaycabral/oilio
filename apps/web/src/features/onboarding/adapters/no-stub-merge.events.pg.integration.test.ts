import { closeEventStoreDb, getEventStorePool } from '@/shared/db/pg/pool'
import { isUniqueViolation, USERS_WHATSAPP_UNIQUE } from '@/shared/db/pg/unique-violation'
import { getUserById, patchUser, putUser } from '@/shared/db/pg/users-store'
import { buildUser } from '@/shared/fixtures/domain-builders'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * No-merge-by-WhatsApp proof against REAL Postgres (brief 0077 Grupo C, #1276).
 *
 * Folding a stub User into a freshly-claimed login by matching WhatsApp was the
 * SOURCE of the wrong-number breach the brief kills: a mistyped number on a
 * recepcionista stub could silently capture a real person's login. The dedupe
 * (`findClaimableStubByWhatsapp` + `mergeStubUserIntoClaimer`) is GONE — each
 * login is its own user, and a number already owned by someone else is NEVER
 * folded, repointed, or quietly taken over.
 *
 * The invariant now has TWO halves, both proven at the DB here:
 *   1. WhatsApp is GLOBALLY unique (`users_whatsapp_unique`): a completion write
 *      with a number that already has an owner is REFUSED (23505) — there can
 *      never be a second user on that number (the merge's escape hatch is gone).
 *   2. No side effects on refusal: the refused write leaves the existing owner
 *      byte-for-byte intact (NOT deleted, NOT repointed) and the claimer stays
 *      its own incomplete identity (no fold into the other uid).
 *
 * Per-run-unique uids so cases never collide across the shared database.
 */

const TS = '2026-06-01T12:00:00.000Z'
const SHARED_WHATSAPP = '5511988887777'

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
    // An existing, fully-completed user already owns SHARED_WHATSAPP.
    const existingUid = uniqueUid('existing')
    await putUser(
      buildUser(existingUid, TS, {
        whatsapp: SHARED_WHATSAPP,
        birthDate: '1985-05-05',
        completionCompleted: true,
        claimedAt: TS,
        displayName: 'Existing Person',
      }),
    )

    // A brand-new OAuth login (claimed, not yet completed) tries to finish
    // completion with the SAME WhatsApp — the exact scenario the old dedupe would
    // have merged. With the merge gone AND the number globally unique, the write
    // is refused by the DB (no merge, no second owner).
    const claimerUid = uniqueUid('claimer')
    await putUser(
      buildUser(claimerUid, TS, {
        whatsapp: null,
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
          whatsapp: SHARED_WHATSAPP,
          birth_date: '1992-02-02',
          completion_completed: true,
        },
        new Date().toISOString(),
      )
    } catch (err) {
      refused = isUniqueViolation(err, USERS_WHATSAPP_UNIQUE)
      if (!refused) throw err
    }
    expect(refused).toBe(true)

    // The other user is byte-for-byte intact — NOT deleted, NOT repointed.
    const existing = await getUserById(existingUid)
    expect(existing).not.toBeNull()
    expect(existing?.displayName).toBe('Existing Person')
    expect(existing?.whatsapp).toBe(SHARED_WHATSAPP)
    expect(existing?.birthDate).toBe('1985-05-05')

    // The claimer kept its own identity (no fold into the other uid) and stayed
    // incomplete — the refused write changed nothing on it.
    const claimer = await getUserById(claimerUid)
    expect(claimer?.uid).toBe(claimerUid)
    expect(claimer?.completionCompleted).toBe(false)
    expect(claimer?.whatsapp).toBeNull()

    // Exactly ONE user owns the number — the global uniqueness invariant holds.
    const owners = await getEventStorePool().query<{ uid: string }>(
      'SELECT uid FROM users WHERE whatsapp = $1',
      [SHARED_WHATSAPP],
    )
    expect(owners.rows.map((r) => r.uid)).toEqual([existingUid])
  })
})
