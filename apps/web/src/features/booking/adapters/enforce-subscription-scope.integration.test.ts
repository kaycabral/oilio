// Integration test for enforceSubscriptionScope.
//
// Valida que a recepção (/agenda) respeita as mesmas regras de plano que
// o self-book — brief 0019, decisão 2026-05-22 (#960/#963) que removeu o
// bypass histórico. Rode emulator antes (pnpm db:start).

import type { Appointment, Customer, Subscription, SubscriptionPlanSnapshot } from '@/domain'
import { getApps, initializeApp, type App } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { enforceSubscriptionScope } from './enforce-subscription-scope'

const PROJECT_ID = `enforce-scope-${Date.now()}`
const TZ = 'America/Sao_Paulo'

let app: App
let db: Firestore

beforeAll(() => {
  app = getApps()[0] ?? initializeApp({ projectId: PROJECT_ID })
  db = getFirestore(app)
})

function uniqueOrgId(label: string) {
  return `t-${label}-${Math.random().toString(36).slice(2, 8)}`
}

function buildPlanSnapshot(
  overrides: Partial<SubscriptionPlanSnapshot> = {},
): SubscriptionPlanSnapshot {
  return {
    planId: 'p1',
    name: 'Plan',
    priceCents: 10000,
    billingCycle: 'monthly',
    includedItemIds: [],
    includedCategoryIds: [],
    usageLimit: { kind: 'unlimited' },
    ...overrides,
  }
}

async function seedCustomer(orgId: string, customerId: string, userId: string): Promise<void> {
  const customer: Customer = {
    id: customerId,
    orgId,
    userId,
    name: 'Cliente Teste',
    whatsapp: '+5511999999999',
    email: null,
    birthDate: null,
    avatarUrl: null,
    archivedAt: null,
    deactivatedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  await db.collection('orgs').doc(orgId).collection('customers').doc(customerId).set(customer)
}

async function seedSubscription(
  orgId: string,
  customerId: string,
  customerUserId: string,
  plan: SubscriptionPlanSnapshot,
): Promise<void> {
  const now = new Date().toISOString()
  const sub: Subscription = {
    id: 'sub-1',
    orgId,
    unitId: 'unit-a',
    customerId,
    customerUserId,
    plan,
    status: 'active',
    currentPeriod: { startAt: now, endAt: '2099-01-01T00:00:00.000Z', consumed: 0 },
    cancelAtPeriodEnd: false,
    nextChargeDate: null,
    pastDueCycles: 0,
    pastDueThreshold: 2,
    cancellationReason: null,
    cancelledAt: null,
    createdAt: now,
    updatedAt: now,
  }
  await db.collection('orgs').doc(orgId).collection('subscriptions').doc(sub.id).set(sub)
}

async function seedAppointment(
  orgId: string,
  appt: Pick<Appointment, 'id' | 'customerId' | 'startAt'>,
): Promise<void> {
  const startMs = new Date(appt.startAt).getTime()
  const full: Appointment = {
    id: appt.id,
    orgId,
    unitId: 'u1',
    professionalId: 'p1',
    customerId: appt.customerId,
    serviceId: 's1',
    startAt: appt.startAt,
    endAt: new Date(startMs + 30 * 60_000).toISOString(),
    status: 'scheduled',
    servicePriceCentsSnapshot: 5000,
    serviceDurationMinutesSnapshot: 30,
    commissionSnapshot: null,
    cancellationPolicySnapshot: null,
    customerUserId: 'u-1',
    professionalUserId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  await db.collection('orgs').doc(orgId).collection('appointments').doc(full.id).set(full)
}

describe('enforceSubscriptionScope', () => {
  let orgId: string

  beforeEach(() => {
    orgId = uniqueOrgId('scope')
  })

  it('passa quando cliente não tem subscription ativa', async () => {
    await seedCustomer(orgId, 'c1', 'u-1')
    const res = await enforceSubscriptionScope({
      db,
      orgId,
      orgTimezone: TZ,
      customerId: 'c1',
      unitId: 'u-any',
      startAt: '2026-08-15T13:00:00.000Z',
    })
    expect(res).toEqual({ ok: true })
  })

  it('bloqueia quando unit fora do unitAllowlist', async () => {
    await seedCustomer(orgId, 'c1', 'u-1')
    await seedSubscription(
      orgId,
      'c1',
      'u-1',
      buildPlanSnapshot({ unitAllowlist: ['u-permitida'] }),
    )
    const res = await enforceSubscriptionScope({
      db,
      orgId,
      orgTimezone: TZ,
      customerId: 'c1',
      unitId: 'u-proibida',
      startAt: '2026-08-15T13:00:00.000Z',
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.rule).toBe('unitAllowlist')
  })

  it('libera quando unit dentro do unitAllowlist', async () => {
    await seedCustomer(orgId, 'c1', 'u-1')
    await seedSubscription(
      orgId,
      'c1',
      'u-1',
      buildPlanSnapshot({ unitAllowlist: ['u-permitida'] }),
    )
    const res = await enforceSubscriptionScope({
      db,
      orgId,
      orgTimezone: TZ,
      customerId: 'c1',
      unitId: 'u-permitida',
      startAt: '2026-08-15T13:00:00.000Z',
    })
    expect(res).toEqual({ ok: true })
  })

  it('bloqueia ao bater maxPerDay', async () => {
    await seedCustomer(orgId, 'c1', 'u-1')
    await seedSubscription(
      orgId,
      'c1',
      'u-1',
      buildPlanSnapshot({ bookingLimits: { maxPerDay: 1 } }),
    )
    await seedAppointment(orgId, {
      id: 'a-existing',
      customerId: 'c1',
      startAt: '2026-08-15T13:00:00.000Z',
    })
    const res = await enforceSubscriptionScope({
      db,
      orgId,
      orgTimezone: TZ,
      customerId: 'c1',
      unitId: 'u1',
      startAt: '2026-08-15T18:00:00.000Z',
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.rule).toBe('maxPerDay')
  })

  it('exclui o próprio appointment quando excludeAppointmentId é passado (update)', async () => {
    await seedCustomer(orgId, 'c1', 'u-1')
    await seedSubscription(
      orgId,
      'c1',
      'u-1',
      buildPlanSnapshot({ bookingLimits: { maxPerDay: 1 } }),
    )
    await seedAppointment(orgId, {
      id: 'a-moving',
      customerId: 'c1',
      startAt: '2026-08-15T13:00:00.000Z',
    })
    const res = await enforceSubscriptionScope({
      db,
      orgId,
      orgTimezone: TZ,
      customerId: 'c1',
      unitId: 'u1',
      startAt: '2026-08-15T18:00:00.000Z',
      excludeAppointmentId: 'a-moving',
    })
    expect(res).toEqual({ ok: true })
  })
})
