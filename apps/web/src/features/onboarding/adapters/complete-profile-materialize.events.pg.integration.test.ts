import { closeEventStoreDb, getEventStorePool } from '@/shared/db/pg/pool'
import { putUser } from '@/shared/db/pg/users-store'
import { buildUser } from '@/shared/fixtures/domain-builders'
import { listCustomersForOrg } from '@/shared/org/customer-read'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const REDIRECT_MESSAGE = 'NEXT_REDIRECT_TEST_SENTINEL'
let sessionUid: string | null = null

vi.mock('@/shared/auth/session', () => ({
  getSessionUser: () => (sessionUid ? Promise.resolve({ uid: sessionUid }) : Promise.resolve(null)),
}))

vi.mock('next/navigation', () => ({
  redirect: () => {
    throw new Error(REDIRECT_MESSAGE)
  },
}))

const { completeProfile } = await import('./complete-profile.actions')

const TS = '2026-06-01T12:00:00.000Z'

let seq = 0
function uniq(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now()}-${seq}`
}

async function seedPublishedOrg(orgId: string, slug: string): Promise<void> {
  const pool = getEventStorePool()
  await pool.query(
    `INSERT INTO orgs
       (org_id, id, last_event_version, name, slug, vertical, branding, owner_user_id,
        created_at, updated_at)
     VALUES ($1, $1, 1, 'Org', $2, 'barbershop', '{"logoUrl":null,"bannerUrl":null,"description":null}'::jsonb, 'owner', now(), now())
     ON CONFLICT (org_id) DO NOTHING`,
    [orgId, slug],
  )
  await pool.query(
    `INSERT INTO public_org_directory
       (org_id, slug, name, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1, $2, 'Org', 'barbershop', 'owner', '{"logoUrl":null,"bannerUrl":null,"description":null}'::jsonb, now(), now())
     ON CONFLICT (org_id) DO NOTHING`,
    [orgId, slug],
  )
}

function completionForm(opts: { context?: string; next?: string }): FormData {
  const fd = new FormData()
  fd.set('name', 'Cliente Novo')
  fd.set('mobile', '11999990000')
  fd.set('birthDate', '1990-05-05')
  if (opts.next) fd.set('next', opts.next)
  if (opts.context) fd.set('context', opts.context)
  return fd
}

async function runComplete(fd: FormData): Promise<void> {
  try {
    await completeProfile(fd)
  } catch (e) {
    if (!(e instanceof Error) || e.message !== REDIRECT_MESSAGE) throw e
  }
}

describe('completeProfile materializes a Customer (brief 0077 #1278)', () => {
  beforeEach(async () => {
    const pool = getEventStorePool()
    await pool.query("DELETE FROM client_funnel_events WHERE org_id LIKE 'org-mat-%'")
    await pool.query("DELETE FROM customers WHERE org_id LIKE 'org-mat-%'")
    await pool.query("DELETE FROM public_org_directory WHERE org_id LIKE 'org-mat-%'")
    await pool.query("DELETE FROM orgs WHERE org_id LIKE 'org-mat-%'")
    await pool.query("DELETE FROM users WHERE uid LIKE 'u-mat-%'")
  })

  afterEach(() => {
    sessionUid = null
  })

  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('creates the Customer + acquisition + funnel events on a signup-context completion', async () => {
    const orgId = uniq('org-mat')
    const slug = uniq('slug')
    await seedPublishedOrg(orgId, slug)

    const uid = uniq('u-mat')
    sessionUid = uid
    await putUser(buildUser(uid, TS, { completionCompleted: false, claimedAt: TS }))

    await runComplete(
      completionForm({ context: `from=${slug}&cbrl_source=whatsapp&cbrl_intent=signup` }),
    )

    const customers = await listCustomersForOrg(orgId)
    expect(customers).toHaveLength(1)
    expect(customers[0]?.userId).toBe(uid)
    expect(customers[0]?.acquisition?.source).toBe('whatsapp')

    const events = await getEventStorePool().query<{ event: string }>(
      'SELECT event FROM client_funnel_events WHERE org_id = $1 ORDER BY id',
      [orgId],
    )
    expect(events.rows.map((r) => r.event)).toEqual([
      'client_signed_in',
      'client_profile_completed',
    ])
  })

  it('is idempotent — re-completing does not create a second Customer', async () => {
    const orgId = uniq('org-mat')
    const slug = uniq('slug')
    await seedPublishedOrg(orgId, slug)

    const uid = uniq('u-mat')
    sessionUid = uid
    await putUser(buildUser(uid, TS, { completionCompleted: false, claimedAt: TS }))

    const ctx = `from=${slug}&cbrl_source=qr&cbrl_intent=signup`
    await runComplete(completionForm({ context: ctx }))
    await runComplete(completionForm({ context: ctx }))

    const customers = await listCustomersForOrg(orgId)
    expect(customers).toHaveLength(1)
  })

  it('creates NO Customer for a plain platform signup (no establishment context)', async () => {
    const orgId = uniq('org-mat')
    const slug = uniq('slug')
    await seedPublishedOrg(orgId, slug)

    const uid = uniq('u-mat')
    sessionUid = uid
    await putUser(buildUser(uid, TS, { completionCompleted: false, claimedAt: TS }))

    await runComplete(completionForm({ next: '/dashboard' }))

    expect(await listCustomersForOrg(orgId)).toHaveLength(0)
  })
})
