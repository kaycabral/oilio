// Integration test for the CUSTOMER erasure cascade (#1101 / brief 0032 AC-12 +
// AC-14, Cenário 7). Runs against the Firestore emulator via the admin SDK — no
// mocks. The cascade cancels the active subscription immediately, stops its
// pending charges, and cancels future appointments; past records are left.
// Re-running is idempotent (no throw, no double-cancel).
//
// Like the sibling block test, every fixture uses a per-run-unique org/user
// id (Date.now + counter); we never wipe globally and read only our own ids.

import { describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve({ get: () => null }),
}))

import { getAdminFirestore } from '@/shared/db'
import { buildAppointment, buildCharge, buildSubscription } from '@/shared/fixtures/domain-builders'
import { eraseCustomerCascadeInOrg, hasActiveSubscriptionInOrg } from './erase-customer-cascade'

import type { AppointmentStatus, ChargeStatus, SubscriptionStatus } from '@/domain'

const db = getAdminFirestore()

let seq = 0
function uniqueId(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now()}-${seq}`
}

async function seedSubscription(
  orgId: string,
  customerUserId: string,
  status: SubscriptionStatus,
): Promise<string> {
  const ref = db.collection('orgs').doc(orgId).collection('subscriptions').doc()
  const now = new Date().toISOString()
  await ref.set({
    ...buildSubscription(ref.id, orgId, now, {
      customerId: uniqueId('cust'),
      customerUserId,
      status,
    }),
    _version: 1,
  })
  return ref.id
}

async function seedCharge(
  orgId: string,
  subscriptionId: string,
  status: ChargeStatus,
): Promise<string> {
  const ref = db.collection('orgs').doc(orgId).collection('charges').doc()
  const now = new Date().toISOString()
  await ref.set({
    ...buildCharge(ref.id, orgId, now, { subscriptionId, status }),
    _version: 1,
  })
  return ref.id
}

async function seedAppointment(
  orgId: string,
  customerUserId: string,
  startAt: string,
  status: AppointmentStatus,
): Promise<string> {
  const ref = db.collection('orgs').doc(orgId).collection('appointments').doc()
  const now = new Date().toISOString()
  await ref.set({
    ...buildAppointment(ref.id, orgId, now, {
      startAt,
      endAt: startAt,
      status,
      customerUserId,
    }),
    _version: 1,
  })
  return ref.id
}

const future = () => new Date(Date.now() + 86_400_000).toISOString()
const past = () => new Date(Date.now() - 86_400_000).toISOString()

async function statusOf(orgId: string, coll: string, id: string): Promise<string | undefined> {
  const snap = await db.collection('orgs').doc(orgId).collection(coll).doc(id).get()
  return (snap.data() as { status?: string } | undefined)?.status
}

describe('eraseCustomerCascadeInOrg', () => {
  it('cancels the active subscription + pending charges + future appointments; leaves the past', async () => {
    const orgId = uniqueId('org')
    const userId = uniqueId('subject')

    const subId = await seedSubscription(orgId, userId, 'active')
    const scheduledCharge = await seedCharge(orgId, subId, 'scheduled')
    const recoveringCharge = await seedCharge(orgId, subId, 'recovering')
    const paidCharge = await seedCharge(orgId, subId, 'paid')
    const futureAppt = await seedAppointment(orgId, userId, future(), 'scheduled')
    const pastAppt = await seedAppointment(orgId, userId, past(), 'scheduled')

    expect(await hasActiveSubscriptionInOrg(orgId, userId)).toBe(true)

    const result = await eraseCustomerCascadeInOrg(orgId, userId)

    expect(result.hadActiveSubscription).toBe(true)
    expect(result.cancelledSubscriptions).toBe(1)
    expect(result.cancelledCharges).toBe(2)
    expect(result.cancelledAppointments).toBe(1)

    expect(await statusOf(orgId, 'subscriptions', subId)).toBe('cancelled')
    expect(await statusOf(orgId, 'charges', scheduledCharge)).toBe('cancelled')
    expect(await statusOf(orgId, 'charges', recoveringCharge)).toBe('cancelled')
    // Past (paid) charge retained, untouched.
    expect(await statusOf(orgId, 'charges', paidCharge)).toBe('paid')
    // Future appointment cancelled, past one retained.
    expect(await statusOf(orgId, 'appointments', futureAppt)).toBe('cancelled')
    expect(await statusOf(orgId, 'appointments', pastAppt)).toBe('scheduled')
  })

  it('is idempotent — re-running does not throw or double-cancel', async () => {
    const orgId = uniqueId('org')
    const userId = uniqueId('subject')

    const subId = await seedSubscription(orgId, userId, 'active')
    await seedCharge(orgId, subId, 'scheduled')
    await seedAppointment(orgId, userId, future(), 'scheduled')

    await eraseCustomerCascadeInOrg(orgId, userId)
    // Second run: everything already terminal → no work, no throw.
    const second = await eraseCustomerCascadeInOrg(orgId, userId)

    expect(second.hadActiveSubscription).toBe(false)
    expect(second.cancelledSubscriptions).toBe(0)
    expect(second.cancelledCharges).toBe(0)
    expect(second.cancelledAppointments).toBe(0)
  })

  it('reports no active subscription when there is none (no-op cascade)', async () => {
    const orgId = uniqueId('org')
    const userId = uniqueId('subject')
    await seedSubscription(orgId, userId, 'cancelled')

    expect(await hasActiveSubscriptionInOrg(orgId, userId)).toBe(false)
    const result = await eraseCustomerCascadeInOrg(orgId, userId)
    expect(result.hadActiveSubscription).toBe(false)
    expect(result.cancelledSubscriptions).toBe(0)
  })

  it('is a no-op for an empty userId (anonymous walk-in)', async () => {
    const result = await eraseCustomerCascadeInOrg(uniqueId('org'), '')
    expect(result).toEqual({
      hadActiveSubscription: false,
      cancelledSubscriptions: 0,
      cancelledCharges: 0,
      cancelledAppointments: 0,
    })
  })
})
