// Integration test for the CUSTOMER erasure cascade (#1101 / brief 0032 AC-12 +
// AC-14, Cenário 7). Runs against the Firestore emulator via the admin SDK — no
// mocks. The cascade cancels the active subscription immediately, stops its
// pending charges, and cancels future appointments; past records are left.
// Re-running is idempotent (no throw, no double-cancel).
//
// Like the sibling block test, every fixture uses a per-run-unique tenant/user
// id (Date.now + counter); we never wipe globally and read only our own ids.

import { describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve({ get: () => null }),
}))

import { getAdminFirestore } from '@/shared/db'
import { buildAppointment, buildCharge, buildSubscription } from '@/shared/fixtures/domain-builders'
import {
  eraseCustomerCascadeInTenant,
  hasActiveSubscriptionInTenant,
} from './erase-customer-cascade'

import type { AppointmentStatus, ChargeStatus, SubscriptionStatus } from '@/domain'

const db = getAdminFirestore()

let seq = 0
function uniqueId(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now()}-${seq}`
}

async function seedSubscription(
  tenantId: string,
  customerUserId: string,
  status: SubscriptionStatus,
): Promise<string> {
  const ref = db.collection('tenants').doc(tenantId).collection('subscriptions').doc()
  const now = new Date().toISOString()
  await ref.set({
    ...buildSubscription(ref.id, tenantId, now, {
      customerId: uniqueId('cust'),
      customerUserId,
      status,
    }),
    _version: 1,
  })
  return ref.id
}

async function seedCharge(
  tenantId: string,
  subscriptionId: string,
  status: ChargeStatus,
): Promise<string> {
  const ref = db.collection('tenants').doc(tenantId).collection('charges').doc()
  const now = new Date().toISOString()
  await ref.set({
    ...buildCharge(ref.id, tenantId, now, { subscriptionId, status }),
    _version: 1,
  })
  return ref.id
}

async function seedAppointment(
  tenantId: string,
  customerUserId: string,
  startAt: string,
  status: AppointmentStatus,
): Promise<string> {
  const ref = db.collection('tenants').doc(tenantId).collection('appointments').doc()
  const now = new Date().toISOString()
  await ref.set({
    ...buildAppointment(ref.id, tenantId, now, {
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

async function statusOf(tenantId: string, coll: string, id: string): Promise<string | undefined> {
  const snap = await db.collection('tenants').doc(tenantId).collection(coll).doc(id).get()
  return (snap.data() as { status?: string } | undefined)?.status
}

describe('eraseCustomerCascadeInTenant', () => {
  it('cancels the active subscription + pending charges + future appointments; leaves the past', async () => {
    const tenantId = uniqueId('tenant')
    const userId = uniqueId('subject')

    const subId = await seedSubscription(tenantId, userId, 'active')
    const scheduledCharge = await seedCharge(tenantId, subId, 'scheduled')
    const recoveringCharge = await seedCharge(tenantId, subId, 'recovering')
    const paidCharge = await seedCharge(tenantId, subId, 'paid')
    const futureAppt = await seedAppointment(tenantId, userId, future(), 'scheduled')
    const pastAppt = await seedAppointment(tenantId, userId, past(), 'scheduled')

    expect(await hasActiveSubscriptionInTenant(tenantId, userId)).toBe(true)

    const result = await eraseCustomerCascadeInTenant(tenantId, userId)

    expect(result.hadActiveSubscription).toBe(true)
    expect(result.cancelledSubscriptions).toBe(1)
    expect(result.cancelledCharges).toBe(2)
    expect(result.cancelledAppointments).toBe(1)

    expect(await statusOf(tenantId, 'subscriptions', subId)).toBe('cancelled')
    expect(await statusOf(tenantId, 'charges', scheduledCharge)).toBe('cancelled')
    expect(await statusOf(tenantId, 'charges', recoveringCharge)).toBe('cancelled')
    // Past (paid) charge retained, untouched.
    expect(await statusOf(tenantId, 'charges', paidCharge)).toBe('paid')
    // Future appointment cancelled, past one retained.
    expect(await statusOf(tenantId, 'appointments', futureAppt)).toBe('cancelled')
    expect(await statusOf(tenantId, 'appointments', pastAppt)).toBe('scheduled')
  })

  it('is idempotent — re-running does not throw or double-cancel', async () => {
    const tenantId = uniqueId('tenant')
    const userId = uniqueId('subject')

    const subId = await seedSubscription(tenantId, userId, 'active')
    await seedCharge(tenantId, subId, 'scheduled')
    await seedAppointment(tenantId, userId, future(), 'scheduled')

    await eraseCustomerCascadeInTenant(tenantId, userId)
    // Second run: everything already terminal → no work, no throw.
    const second = await eraseCustomerCascadeInTenant(tenantId, userId)

    expect(second.hadActiveSubscription).toBe(false)
    expect(second.cancelledSubscriptions).toBe(0)
    expect(second.cancelledCharges).toBe(0)
    expect(second.cancelledAppointments).toBe(0)
  })

  it('reports no active subscription when there is none (no-op cascade)', async () => {
    const tenantId = uniqueId('tenant')
    const userId = uniqueId('subject')
    await seedSubscription(tenantId, userId, 'cancelled')

    expect(await hasActiveSubscriptionInTenant(tenantId, userId)).toBe(false)
    const result = await eraseCustomerCascadeInTenant(tenantId, userId)
    expect(result.hadActiveSubscription).toBe(false)
    expect(result.cancelledSubscriptions).toBe(0)
  })

  it('is a no-op for an empty userId (anonymous walk-in)', async () => {
    const result = await eraseCustomerCascadeInTenant(uniqueId('tenant'), '')
    expect(result).toEqual({
      hadActiveSubscription: false,
      cancelledSubscriptions: 0,
      cancelledCharges: 0,
      cancelledAppointments: 0,
    })
  })
})
