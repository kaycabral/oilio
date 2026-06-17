// Integration test for the active-reference delete guard (brief 0033,
// AC-01/AC-02 — #1068). Runs against the Firestore emulator via the admin SDK —
// no mocks. Proves the core loosening: an ACTIVE reference blocks the
// hard-delete (canDelete=false); a HISTORICAL reference does NOT (canDelete=true,
// snapshot covers the past). Covers all three entities the slice touches:
// subscription-plan, catalog-item, unit.
//
// Every fixture uses a per-run-unique tenant id (Date.now + counter); we never
// wipe globally and read only our own tenant's ids.

import { type MembershipStatus, type SubscriptionStatus } from '@/domain'
import { getAdminFirestore } from '@/shared/db'
import {
  buildAppointment,
  buildMembership,
  buildSubscription,
} from '@/shared/fixtures/domain-builders'
import { describe, expect, it } from 'vitest'
import {
  attachCanDelete,
  canDeleteCatalogItem,
  canDeleteCustomer,
  canDeletePlan,
  canDeleteProfessional,
  canDeleteUnit,
  getCustomerDeletionImpact,
} from './delete-guard'

const db = getAdminFirestore()

let seq = 0
function uniqueTenant(): string {
  seq += 1
  return `t-delguard-${Date.now()}-${seq}`
}

function tenant(tenantId: string) {
  return db.collection('tenants').doc(tenantId)
}

async function seedPlan(tenantId: string): Promise<string> {
  const ref = tenant(tenantId).collection('subscription_plans').doc()
  await ref.set({ id: ref.id, tenantId, name: 'Plano X', archivedAt: null })
  return ref.id
}

async function seedSubscription(
  tenantId: string,
  opts: { planId?: string; includedItemIds?: string[]; status: SubscriptionStatus },
): Promise<void> {
  const ref = tenant(tenantId).collection('subscriptions').doc()
  await ref.set(
    buildSubscription(ref.id, tenantId, new Date().toISOString(), {
      status: opts.status,
      plan: { planId: opts.planId ?? 'unused', includedItemIds: opts.includedItemIds ?? [] },
    }),
  )
}

async function seedCatalogItem(tenantId: string): Promise<string> {
  const ref = tenant(tenantId).collection('catalog_items').doc()
  await ref.set({ id: ref.id, tenantId, name: 'Item X', kind: 'service', archivedAt: null })
  return ref.id
}

async function seedOrder(
  tenantId: string,
  opts: { status: 'open' | 'closed' | 'cancelled'; refId: string },
): Promise<void> {
  const ref = tenant(tenantId).collection('orders').doc()
  await ref.set({
    id: ref.id,
    tenantId,
    status: opts.status,
    items: [{ id: 'i1', kind: 'service', refId: opts.refId, name: 'Item X', quantity: 1 }],
  })
}

async function seedUnit(tenantId: string): Promise<string> {
  const ref = tenant(tenantId).collection('units').doc()
  await ref.set({ id: ref.id, tenantId, name: 'Unidade X', archivedAt: null })
  return ref.id
}

async function seedAppointment(
  tenantId: string,
  opts: { unitId: string; status: 'scheduled' | 'completed' | 'cancelled'; startAt: string },
): Promise<void> {
  const ref = tenant(tenantId).collection('appointments').doc()
  await ref.set(
    buildAppointment(ref.id, tenantId, new Date().toISOString(), {
      unitId: opts.unitId,
      status: opts.status,
      startAt: opts.startAt,
    }),
  )
}

async function seedProfessional(tenantId: string, unitId: string): Promise<void> {
  const ref = tenant(tenantId).collection('professionals').doc()
  await ref.set({ id: ref.id, tenantId, unitIds: [unitId] })
}

// Professional projection carrying a `userId` link (the membership FK) +
// optional unit scope. Returns the professional DOC id.
async function seedProfessionalDoc(
  tenantId: string,
  opts: { userId: string; unitIds?: string[] },
): Promise<string> {
  const ref = tenant(tenantId).collection('professionals').doc()
  await ref.set({ id: ref.id, tenantId, userId: opts.userId, unitIds: opts.unitIds ?? [] })
  return ref.id
}

async function seedMembership(
  tenantId: string,
  userId: string,
  status: MembershipStatus,
): Promise<void> {
  const membership = buildMembership(tenantId, userId, new Date().toISOString(), { status })
  await db.collection('memberships').doc(membership.id).set(membership)
}

async function seedProAppointment(
  tenantId: string,
  opts: {
    professionalId: string
    status: 'scheduled' | 'completed' | 'cancelled'
    startAt: string
  },
): Promise<void> {
  const ref = tenant(tenantId).collection('appointments').doc()
  await ref.set(
    buildAppointment(ref.id, tenantId, new Date().toISOString(), {
      professionalId: opts.professionalId,
      status: opts.status,
      startAt: opts.startAt,
    }),
  )
}

async function seedCustomerAppointment(
  tenantId: string,
  opts: { customerId: string; status: 'scheduled' | 'completed' | 'cancelled'; startAt: string },
): Promise<void> {
  const ref = tenant(tenantId).collection('appointments').doc()
  await ref.set(
    buildAppointment(ref.id, tenantId, new Date().toISOString(), {
      customerId: opts.customerId,
      status: opts.status,
      startAt: opts.startAt,
    }),
  )
}

async function seedCustomerOrder(
  tenantId: string,
  opts: { customerId: string; status: 'open' | 'closed' | 'cancelled' },
): Promise<void> {
  const ref = tenant(tenantId).collection('orders').doc()
  await ref.set({
    id: ref.id,
    tenantId,
    customerId: opts.customerId,
    status: opts.status,
    items: [],
  })
}

async function seedCustomerSubscription(
  tenantId: string,
  opts: { customerId: string; status: SubscriptionStatus; planName?: string; periodEndAt?: string },
): Promise<void> {
  const ref = tenant(tenantId).collection('subscriptions').doc()
  await ref.set(
    buildSubscription(ref.id, tenantId, new Date().toISOString(), {
      customerId: opts.customerId,
      status: opts.status,
      plan: { planId: 'p1', name: opts.planName ?? 'Plano X' },
      currentPeriod: { startAt: past(), endAt: opts.periodEndAt ?? future(), consumed: 0 },
    }),
  )
}

const future = () => new Date(Date.now() + 86_400_000).toISOString()
const past = () => new Date(Date.now() - 86_400_000).toISOString()

describe('canDeletePlan — active vs historical subscription', () => {
  it('no reference → deletable', async () => {
    const t = uniqueTenant()
    const planId = await seedPlan(t)
    expect(await canDeletePlan(t, planId)).toBe(true)
  })

  it('active subscription → blocked', async () => {
    const t = uniqueTenant()
    const planId = await seedPlan(t)
    await seedSubscription(t, { planId, status: 'active' })
    expect(await canDeletePlan(t, planId)).toBe(false)
  })

  it('only a cancelled (historical) subscription → still deletable', async () => {
    const t = uniqueTenant()
    const planId = await seedPlan(t)
    await seedSubscription(t, { planId, status: 'cancelled' })
    await seedSubscription(t, { planId, status: 'cancelled_for_non_payment' })
    expect(await canDeletePlan(t, planId)).toBe(true)
  })
})

describe('canDeleteCatalogItem — open order / active coverage vs historical', () => {
  it('no reference → deletable', async () => {
    const t = uniqueTenant()
    const itemId = await seedCatalogItem(t)
    expect(await canDeleteCatalogItem(t, itemId)).toBe(true)
  })

  it('open order referencing it → blocked', async () => {
    const t = uniqueTenant()
    const itemId = await seedCatalogItem(t)
    await seedOrder(t, { status: 'open', refId: itemId })
    expect(await canDeleteCatalogItem(t, itemId)).toBe(false)
  })

  it('only closed/cancelled orders (historical) → still deletable', async () => {
    const t = uniqueTenant()
    const itemId = await seedCatalogItem(t)
    await seedOrder(t, { status: 'closed', refId: itemId })
    await seedOrder(t, { status: 'cancelled', refId: itemId })
    expect(await canDeleteCatalogItem(t, itemId)).toBe(true)
  })

  it('active subscription covering it → blocked', async () => {
    const t = uniqueTenant()
    const itemId = await seedCatalogItem(t)
    await seedSubscription(t, { includedItemIds: [itemId], status: 'active' })
    expect(await canDeleteCatalogItem(t, itemId)).toBe(false)
  })

  it('only a cancelled subscription covering it (historical) → still deletable', async () => {
    const t = uniqueTenant()
    const itemId = await seedCatalogItem(t)
    await seedSubscription(t, { includedItemIds: [itemId], status: 'cancelled' })
    expect(await canDeleteCatalogItem(t, itemId)).toBe(true)
  })
})

describe('canDeleteUnit — active pro / future appointment vs historical', () => {
  it('no reference → deletable', async () => {
    const t = uniqueTenant()
    const unitId = await seedUnit(t)
    expect(await canDeleteUnit(t, unitId)).toBe(true)
  })

  it('professional scoped to the unit → blocked', async () => {
    const t = uniqueTenant()
    const unitId = await seedUnit(t)
    await seedProfessional(t, unitId)
    expect(await canDeleteUnit(t, unitId)).toBe(false)
  })

  it('future scheduled appointment → blocked', async () => {
    const t = uniqueTenant()
    const unitId = await seedUnit(t)
    await seedAppointment(t, { unitId, status: 'scheduled', startAt: future() })
    expect(await canDeleteUnit(t, unitId)).toBe(false)
  })

  it('only past/completed/cancelled appointments (historical) → still deletable', async () => {
    const t = uniqueTenant()
    const unitId = await seedUnit(t)
    await seedAppointment(t, { unitId, status: 'scheduled', startAt: past() })
    await seedAppointment(t, { unitId, status: 'completed', startAt: future() })
    await seedAppointment(t, { unitId, status: 'cancelled', startAt: future() })
    expect(await canDeleteUnit(t, unitId)).toBe(true)
  })
})

describe('attachCanDelete — per-row precompute (AC-03)', () => {
  it('attaches the reference-based flag per row', async () => {
    const t = uniqueTenant()
    const free = await seedPlan(t)
    const used = await seedPlan(t)
    await seedSubscription(t, { planId: used, status: 'active' })

    const rows = await attachCanDelete([{ id: free }, { id: used }], (id) =>
      canDeletePlan(t, id).then((v) => !v),
    )
    expect(rows.find((r) => r.id === free)?.canDelete).toBe(true)
    expect(rows.find((r) => r.id === used)?.canDelete).toBe(false)
  })
})

describe('canDeleteProfessional — future appointment / active membership vs historical', () => {
  it('no reference (revoked membership, no future appt) → deletable', async () => {
    const t = uniqueTenant()
    const uid = `u-${Date.now()}`
    const proId = await seedProfessionalDoc(t, { userId: uid })
    await seedMembership(t, uid, 'revoked')
    expect(await canDeleteProfessional(t, proId)).toBe(true)
  })

  it('professional doc absent → deletable (nothing to orphan)', async () => {
    const t = uniqueTenant()
    expect(await canDeleteProfessional(t, 'ghost')).toBe(true)
  })

  it('active membership → blocked', async () => {
    const t = uniqueTenant()
    const uid = `u-${Date.now()}`
    const proId = await seedProfessionalDoc(t, { userId: uid })
    await seedMembership(t, uid, 'active')
    expect(await canDeleteProfessional(t, proId)).toBe(false)
  })

  it('suspended membership (0029 deactivation, reversible) → still blocked', async () => {
    const t = uniqueTenant()
    const uid = `u-${Date.now()}`
    const proId = await seedProfessionalDoc(t, { userId: uid })
    await seedMembership(t, uid, 'suspended')
    expect(await canDeleteProfessional(t, proId)).toBe(false)
  })

  it('future scheduled appointment → blocked even after offboarding', async () => {
    const t = uniqueTenant()
    const uid = `u-${Date.now()}`
    const proId = await seedProfessionalDoc(t, { userId: uid })
    await seedMembership(t, uid, 'revoked')
    await seedProAppointment(t, { professionalId: proId, status: 'scheduled', startAt: future() })
    expect(await canDeleteProfessional(t, proId)).toBe(false)
  })

  it('only past/completed/cancelled appointments + revoked membership (historical) → deletable', async () => {
    const t = uniqueTenant()
    const uid = `u-${Date.now()}`
    const proId = await seedProfessionalDoc(t, { userId: uid })
    await seedMembership(t, uid, 'revoked')
    await seedProAppointment(t, { professionalId: proId, status: 'scheduled', startAt: past() })
    await seedProAppointment(t, { professionalId: proId, status: 'completed', startAt: future() })
    await seedProAppointment(t, { professionalId: proId, status: 'cancelled', startAt: future() })
    expect(await canDeleteProfessional(t, proId)).toBe(true)
  })
})

// Operator delete (brief 0033, AC-07 — reescopo v3): the ONLY hard blocker is an
// open comanda. Active subscription + future appointments NO LONGER block — they
// are cascade-cancelled and surfaced in `getCustomerDeletionImpact`.
describe('canDeleteCustomer — only an open comanda blocks', () => {
  it('no reference → deletable', async () => {
    const t = uniqueTenant()
    expect(await canDeleteCustomer(t, `c-${Date.now()}`)).toBe(true)
  })

  it('open comanda → blocked', async () => {
    const t = uniqueTenant()
    const cid = `c-${Date.now()}`
    await seedCustomerOrder(t, { customerId: cid, status: 'open' })
    expect(await canDeleteCustomer(t, cid)).toBe(false)
  })

  it('future appointment → NOT blocked (cascade cancels it)', async () => {
    const t = uniqueTenant()
    const cid = `c-${Date.now()}`
    await seedCustomerAppointment(t, { customerId: cid, status: 'scheduled', startAt: future() })
    expect(await canDeleteCustomer(t, cid)).toBe(true)
  })

  it('active subscription → NOT blocked (cascade cancels it)', async () => {
    const t = uniqueTenant()
    const cid = `c-${Date.now()}`
    await seedCustomerSubscription(t, { customerId: cid, status: 'active' })
    expect(await canDeleteCustomer(t, cid)).toBe(true)
  })

  it('only historical refs (closed/cancelled order, past appt, cancelled sub) → deletable', async () => {
    const t = uniqueTenant()
    const cid = `c-${Date.now()}`
    await seedCustomerOrder(t, { customerId: cid, status: 'closed' })
    await seedCustomerOrder(t, { customerId: cid, status: 'cancelled' })
    await seedCustomerAppointment(t, { customerId: cid, status: 'cancelled', startAt: future() })
    await seedCustomerSubscription(t, { customerId: cid, status: 'cancelled' })
    expect(await canDeleteCustomer(t, cid)).toBe(true)
  })
})

describe('getCustomerDeletionImpact — what removing the customer affects', () => {
  it('no footprint → zeros + hasFootprint false', async () => {
    const t = uniqueTenant()
    const impact = await getCustomerDeletionImpact(t, `c-${Date.now()}`)
    expect(impact).toEqual({
      openComandas: 0,
      activeSubscription: null,
      futureAppointments: 0,
      hasFootprint: false,
    })
  })

  it('active sub + future appts → listed; open comanda counted; hasFootprint true', async () => {
    const t = uniqueTenant()
    const cid = `c-${Date.now()}`
    const due = future()
    await seedCustomerSubscription(t, {
      customerId: cid,
      status: 'active',
      planName: 'Plano Básico',
      periodEndAt: due,
    })
    await seedCustomerAppointment(t, { customerId: cid, status: 'scheduled', startAt: future() })
    await seedCustomerAppointment(t, { customerId: cid, status: 'scheduled', startAt: future() })
    await seedCustomerOrder(t, { customerId: cid, status: 'open' })
    const impact = await getCustomerDeletionImpact(t, cid)
    expect(impact.openComandas).toBe(1)
    expect(impact.activeSubscription).toEqual({ planName: 'Plano Básico', periodEndAt: due })
    expect(impact.futureAppointments).toBe(2)
    expect(impact.hasFootprint).toBe(true)
  })

  it('only historical footprint → hasFootprint true, nothing active', async () => {
    const t = uniqueTenant()
    const cid = `c-${Date.now()}`
    await seedCustomerOrder(t, { customerId: cid, status: 'closed' })
    const impact = await getCustomerDeletionImpact(t, cid)
    expect(impact).toEqual({
      openComandas: 0,
      activeSubscription: null,
      futureAppointments: 0,
      hasFootprint: true,
    })
  })
})
