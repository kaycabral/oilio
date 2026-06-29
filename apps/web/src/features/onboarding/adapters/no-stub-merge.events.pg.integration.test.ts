import { closeEventStoreDb, getEventStorePool } from '@/shared/db/pg/pool'
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
 * login is its own user, and completing a profile with a WhatsApp that already
 * exists on another user must NOT touch that other user.
 *
 * This proves the post-removal invariant at the DB: two distinct users may carry
 * the same WhatsApp and a completion write on one leaves the other byte-for-byte
 * intact (no repoint, no delete). The booking gate (#1275) is what stops a
 * second account from forming for a returning customer — not a silent merge.
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

  it('completing a profile with an already-used WhatsApp leaves the other user untouched', async () => {
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

    // A brand-new OAuth login (claimed, not yet completed) finishes completion
    // with the SAME WhatsApp — the exact scenario the old dedupe would have
    // merged. With the merge gone, this is a plain self-write.
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

    // The other user is byte-for-byte intact — NOT deleted, NOT repointed.
    const existing = await getUserById(existingUid)
    expect(existing).not.toBeNull()
    expect(existing?.displayName).toBe('Existing Person')
    expect(existing?.whatsapp).toBe(SHARED_WHATSAPP)
    expect(existing?.birthDate).toBe('1985-05-05')

    // The claimer kept its own identity (no fold into the other uid).
    const claimer = await getUserById(claimerUid)
    expect(claimer?.uid).toBe(claimerUid)
    expect(claimer?.completionCompleted).toBe(true)
    expect(claimer?.whatsapp).toBe(SHARED_WHATSAPP)

    // Both rows coexist — the same WhatsApp on two users is allowed (no UNIQUE,
    // no merge). They are genuinely separate identities.
    const both = await getEventStorePool().query<{ uid: string }>(
      'SELECT uid FROM users WHERE whatsapp = $1 ORDER BY uid',
      [SHARED_WHATSAPP],
    )
    expect(both.rows.map((r) => r.uid).sort()).toEqual([claimerUid, existingUid].sort())
  })
})
