import { ownerPool } from '@/shared/db/pg/test/owner-pool'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeEventStoreDb } from './pool'

const UNIQUE_VIOLATION = '23505'
const CONSTRAINT = 'users_mobile_unique'
const TS = '2026-06-01T12:00:00.000Z'

let seq = 0
function uniqueUid(label: string): string {
  seq += 1
  return `u-wa-${label}-${Date.now()}-${seq}`
}
function uniqueWa(): string {
  seq += 1
  return `5511${String(910000000 + seq).padStart(9, '0')}`
}

async function insertUser(uid: string, mobile: string | null): Promise<void> {
  await ownerPool().query(
    `INSERT INTO users
       (uid, email_verified, completion_completed, mobile, created_at, updated_at)
     VALUES ($1, false, false, $2, $3, $3)`,
    [uid, mobile, TS],
  )
}

describe('users_mobile_unique (global one-owner-per-number)', () => {
  beforeEach(async () => {
    await ownerPool().query("DELETE FROM users WHERE uid LIKE 'u-wa-%'")
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
      ownerPool().query('UPDATE users SET mobile = $1 WHERE uid = $2', [wa, otherUid]),
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
