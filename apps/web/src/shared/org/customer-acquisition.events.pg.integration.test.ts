import type { Attribution } from '@/domain'
import { closeEventStoreDb, getEventStorePool } from '@/shared/db/pg/pool'
import { getCustomerById } from '@/shared/org/customer-read'
import { ensureSelfSignupCustomer, upsertCustomerWithUser } from '@/shared/org/customer-upsert'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * Acquisition write-once against REAL Postgres (brief 0077 Grupo D — AC-10/AC-11,
 * #1280). The Customer's `acquisition` is the FIRST-touch channel that created the
 * org relationship; a later touch via another channel must NOT overwrite it (that
 * touch lives on the Appointment). The shadow is materialized once and re-entry
 * for the SAME userId returns it untouched. Proven through the real event-sourced
 * path (event → reducer → projection → JSONB column → read).
 *
 * Also pins the post-#1276 contract: `upsertCustomerWithUser` no longer folds by
 * WhatsApp — a quick-add typing a number that already has an owner is REFUSED
 * (the global `users_mobile_unique` index), surfaced as a handled error.
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

  // A distinct, well-formed BR mobile per call so quick-add inserts don't collide
  // across cases OR across runs on the shared DB (the global uniqueness index is
  // exactly what's under test). Stub Users persist (no cleanup), so the number
  // must be unique per run — derive the trailing digits from the wall clock.
  function uniqueMobileRaw(): string {
    seq += 1
    // DDD 11 + the mandatory mobile `9` + 8 unique subscriber digits, so the
    // number is a valid BR mobile (normalizeBrazilMobile / the DB br_format
    // CHECK both require the 9th digit).
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
    // First touch: QR (materializes the shadow + the global User).
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

    // Same human (same userId) re-enters via WhatsApp invite — different channel.
    // Re-entry is keyed by userId (no WhatsApp fold), the real idempotent path.
    const second = await ensureSelfSignupCustomer(orgId, first.userId, {
      source: 'whatsapp',
      medium: 'invite',
      campaign: null,
      content: null,
      term: null,
      actorId: 'recep-1',
      intent: 'signup',
    })
    // Same customer shadow reused (no second customer created).
    expect(second.customerId).toBe(first.customerId)
    expect(second.created).toBe(false)

    // Acquisition stays the ORIGINAL QR touch — write-once.
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

    // A second quick-add typing the SAME number is refused — the global
    // uniqueness index forbids a second User on that number (brief 0077, #1276).
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
