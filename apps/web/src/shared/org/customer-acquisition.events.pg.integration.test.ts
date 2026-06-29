import type { Attribution } from '@/domain'
import { closeEventStoreDb, getEventStorePool } from '@/shared/db/pg/pool'
import { getCustomerById } from '@/shared/org/customer-read'
import { upsertCustomerWithUser } from '@/shared/org/customer-upsert'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * Acquisition write-once against REAL Postgres (brief 0077 Grupo D — AC-10/AC-11,
 * #1280). The Customer's `acquisition` is the FIRST-touch channel that created the
 * org relationship; a later booking via another channel must NOT overwrite it
 * (that touch lives on the Appointment). `upsertCustomerWithUser` only sets
 * `acquisition` when it materializes the shadow — re-entry returns the existing
 * customer untouched. Proven through the real event-sourced path (event → reducer
 * → projection → JSONB column → read).
 *
 * Per-run-unique org so cases never collide on the shared database.
 */

let seq = 0
function uniq(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now()}-${seq}`
}

async function seedOrg(orgId: string): Promise<void> {
  // Minimal org row so the customer FK (org_id → orgs.org_id) holds. Raw insert
  // over the superuser pool (RLS bypassed for seed). PK is `org_id`.
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

  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('persists the acquisition on first materialization (round-trips JSONB)', async () => {
    const orgId = uniq('org-acq')
    await seedOrg(orgId)
    const r = await upsertCustomerWithUser({
      orgId,
      name: 'Cliente',
      whatsappRaw: '11999990000',
      email: null,
      birthDate: null,
      acquisition: QR_ACQUISITION,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return

    const customer = await getCustomerById(orgId, r.customerId)
    expect(customer?.acquisition).toEqual(QR_ACQUISITION)
  })

  it('does NOT overwrite acquisition when the same customer re-upserts via another channel', async () => {
    const orgId = uniq('org-acq')
    await seedOrg(orgId)
    // First touch: QR.
    const first = await upsertCustomerWithUser({
      orgId,
      name: 'Cliente',
      whatsappRaw: '11999991111',
      email: null,
      birthDate: null,
      acquisition: QR_ACQUISITION,
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return

    // Same human (same whatsapp) re-books via WhatsApp invite — different channel.
    const second = await upsertCustomerWithUser({
      orgId,
      name: 'Cliente',
      whatsappRaw: '11999991111',
      email: null,
      birthDate: null,
      acquisition: {
        source: 'whatsapp',
        medium: 'invite',
        campaign: null,
        content: null,
        term: null,
        actorId: 'recep-1',
        intent: 'signup',
      },
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    // Same customer shadow reused (no second customer created).
    expect(second.customerId).toBe(first.customerId)

    // Acquisition stays the ORIGINAL QR touch — write-once.
    const customer = await getCustomerById(orgId, first.customerId)
    expect(customer?.acquisition).toEqual(QR_ACQUISITION)
  })

  it('leaves acquisition null when none is provided', async () => {
    const orgId = uniq('org-acq')
    await seedOrg(orgId)
    const r = await upsertCustomerWithUser({
      orgId,
      name: 'Cliente',
      whatsappRaw: '11999992222',
      email: null,
      birthDate: null,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const customer = await getCustomerById(orgId, r.customerId)
    expect(customer?.acquisition).toBeNull()
  })
})
