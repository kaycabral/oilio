import type { Attribution } from '@/domain'
import { closeEventStoreDb, getEventStorePool } from '@/shared/db/pg/pool'
import { getCustomerById } from '@/shared/org/customer-read'
import { ensureSelfSignupCustomer, upsertCustomerWithUser } from '@/shared/org/customer-upsert'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

let seq = 0
function uniq(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now()}-${seq}`
}

async function seedOrg(orgId: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO orgs
       (org_id, id, last_event_version, name, slug, vertical, branding, owner_user_id,
        created_at, updated_at)
     VALUES ($1, $1, 1, 'Org', $2, 'barbershop', '{}'::jsonb, 'owner', now(), now())
     ON CONFLICT (org_id) DO NOTHING`,
    [orgId, uniq('slug')],
  )
}

const QR_ACQUISITION: Attribution = {
  source: 'qr',
  medium: 'invite',
  campaign: 'verao',
  content: null,
  term: null,
  actorId: null,
  intent: 'booking',
}

describe('customer acquisition write-once (brief 0077 AC-10/AC-11)', () => {
  beforeEach(async () => {
    await getEventStorePool().query("DELETE FROM customers WHERE org_id LIKE 'org-acq-%'")
    await getEventStorePool().query("DELETE FROM orgs WHERE org_id LIKE 'org-acq-%'")
  })

  function uniqueMobileRaw(): string {
    seq += 1
    const tail = String((Date.now() + seq) % 100_000_000).padStart(8, '0')
    return `119${tail}`
  }

  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('persists the acquisition on first materialization (round-trips JSONB)', async () => {
    const orgId = uniq('org-acq')
    await seedOrg(orgId)
    const r = await upsertCustomerWithUser({
      orgId,
      name: 'Cliente',
      mobileRaw: uniqueMobileRaw(),
      email: null,
      birthDate: null,
      acquisition: QR_ACQUISITION,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return

    const customer = await getCustomerById(orgId, r.customerId)
    expect(customer?.acquisition).toEqual(QR_ACQUISITION)
  })

  it('does NOT overwrite acquisition when the same userId re-enters via another channel', async () => {
    const orgId = uniq('org-acq')
    await seedOrg(orgId)
    const first = await upsertCustomerWithUser({
      orgId,
      name: 'Cliente',
      mobileRaw: uniqueMobileRaw(),
      email: null,
      birthDate: null,
      acquisition: QR_ACQUISITION,
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const second = await ensureSelfSignupCustomer(orgId, first.userId, {
      source: 'whatsapp',
      medium: 'invite',
      campaign: null,
      content: null,
      term: null,
      actorId: 'recep-1',
      intent: 'signup',
    })
    expect(second.customerId).toBe(first.customerId)
    expect(second.created).toBe(false)

    const customer = await getCustomerById(orgId, first.customerId)
    expect(customer?.acquisition).toEqual(QR_ACQUISITION)
  })

  it('REFUSES a quick-add whose WhatsApp already has an owner (no silent fold)', async () => {
    const orgId = uniq('org-acq')
    await seedOrg(orgId)
    const sharedNumber = uniqueMobileRaw()
    const first = await upsertCustomerWithUser({
      orgId,
      name: 'Dona do Número',
      mobileRaw: sharedNumber,
      email: null,
      birthDate: null,
    })
    expect(first.ok).toBe(true)

    const second = await upsertCustomerWithUser({
      orgId,
      name: 'Outra Pessoa',
      mobileRaw: sharedNumber,
      email: null,
      birthDate: null,
    })
    expect(second.ok).toBe(false)
    if (second.ok) return
    expect(second.error).toContain('convite')
  })

  it('leaves acquisition null when none is provided', async () => {
    const orgId = uniq('org-acq')
    await seedOrg(orgId)
    const r = await upsertCustomerWithUser({
      orgId,
      name: 'Cliente',
      mobileRaw: uniqueMobileRaw(),
      email: null,
      birthDate: null,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const customer = await getCustomerById(orgId, r.customerId)
    expect(customer?.acquisition).toBeNull()
  })
})
