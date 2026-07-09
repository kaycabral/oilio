import { closeEventStoreDb, getEventStorePool } from '@/shared/db/pg/pool'
import { putUser } from '@/shared/db/pg/users-store'
import { buildUser } from '@/shared/fixtures/domain-builders'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let sessionUid: string | null = null

vi.mock('@/shared/firebase/admin', () => ({
  getSessionUser: () =>
    sessionUid ? Promise.resolve({ uid: sessionUid, emailVerified: true }) : Promise.resolve(null),
}))

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

const { createOrg } = await import('./onboarding.actions')

const TS = '2026-06-01T12:00:00.000Z'
let seq = 0
function uniqUser(): string {
  seq += 1
  return `u-race-${Date.now()}-${seq}`
}

function orgForm(name: string): FormData {
  const fd = new FormData()
  fd.set('name', name)
  fd.set('vertical', 'barbershop')
  return fd
}

async function ownerMembershipCount(userId: string): Promise<number> {
  const pool = getEventStorePool()
  const res = await pool.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM memberships WHERE user_id = $1 AND role = 'owner'",
    [userId],
  )
  return Number(res.rows[0]?.n ?? '0')
}

describe('createOrg — 2º Negócio Free via corrida (brief 0088 H2)', () => {
  beforeEach(async () => {
    const pool = getEventStorePool()
    await pool.query("DELETE FROM memberships WHERE user_id LIKE 'u-race-%'")
    await pool.query("DELETE FROM public_org_directory WHERE owner_user_id LIKE 'u-race-%'")
    await pool.query("DELETE FROM orgs WHERE owner_user_id LIKE 'u-race-%'")
    await pool.query("DELETE FROM users WHERE uid LIKE 'u-race-%'")
  })

  afterEach(() => {
    sessionUid = null
  })

  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('dois createOrg concorrentes de um usuário Free criam APENAS 1 Negócio', async () => {
    const uid = uniqUser()
    await putUser(buildUser(uid, TS, { emailVerified: true }))
    sessionUid = uid

    const [a, b] = await Promise.all([
      createOrg(orgForm('Barbearia Um')),
      createOrg(orgForm('Barbearia Dois')),
    ])

    const oks = [a, b].filter((r) => r.ok)
    const denials = [a, b].filter((r) => !r.ok)
    expect(oks).toHaveLength(1)
    expect(denials).toHaveLength(1)
    const denial = denials[0]
    if (denial && !denial.ok) expect(denial.error).toContain('plano Grátis')

    expect(await ownerMembershipCount(uid)).toBe(1)
  })

  it('primeiro Negócio de um usuário Free é permitido (sequencial)', async () => {
    const uid = uniqUser()
    await putUser(buildUser(uid, TS, { emailVerified: true }))
    sessionUid = uid

    const r = await createOrg(orgForm('Barbearia Única'))
    expect(r.ok).toBe(true)
    expect(await ownerMembershipCount(uid)).toBe(1)
  })
})
