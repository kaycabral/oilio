// Server-side proof for the customer-history real value (#1329): a COMPLETED
// appointment that closed into an order shows what the customer really
// experienced — "Coberto pelo plano" when the plan absorbed it, the amount
// actually charged when it was a (possibly discounted) sale — instead of the
// service price snapshot. A completed appointment with NO linked closed order
// keeps the snapshot (legacy / no-show flows).
//
// Seam: the projections are seeded directly (final state only — no close saga),
// the customer→org reverse index is written through the real `linkCustomerOrg`
// (per-subject RLS), and `loadMyAppointmentsPage` runs as the customer. Only
// `getSessionUser` is mocked.

import { defaultPermissionsForRole, type Role } from '@/domain'
import { closeEventStoreDb, getEventStorePool } from '@/shared/db/pg/pool'
import { putUser } from '@/shared/db/pg/users-store'
import type { SessionUser } from '@/shared/firebase/admin'
import { buildStoredCustomer, buildUser } from '@/shared/fixtures/domain-builders'
import { linkCustomerOrg } from '@/shared/identity/org-links'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getSessionUser: vi.fn<() => Promise<SessionUser | null>>() }))
vi.mock('@/shared/firebase/admin', () => ({ getSessionUser: mocks.getSessionUser }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { loadMyAppointmentsPage } from './load-me'

const TS = '2026-06-01T12:00:00.000Z'
const START = '2026-05-01T13:00:00.000Z'
const END = '2026-05-01T13:30:00.000Z'

const pool = () => getEventStorePool()
const TABLES =
  'events, projections, member_operation_units, member_operation_services, member_operations, appointments, orders, customers, catalog_items, memberships, units, orgs, users, org_links'

let seq = 0
const uid = (p: string): string => `${p}-${Date.now()}-${++seq}`

async function seedOrg(orgId: string): Promise<void> {
  await pool().query(
    `INSERT INTO orgs (org_id, id, last_event_version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1,$1,1,'Org','slug-'||$1,'barbershop','owner',$2::jsonb,$3,$3)
     ON CONFLICT (org_id) DO NOTHING`,
    [orgId, JSON.stringify({ logoUrl: null, bannerUrl: null, description: null }), TS],
  )
}

async function seedUnit(orgId: string, unitId: string): Promise<void> {
  await pool().query(
    `INSERT INTO units (org_id, id, last_event_version, name, slug, timezone, agenda_mode, fiscal_kind, address, agenda, fiscal, archived_at, created_at, updated_at)
     VALUES ($1,$2,1,'Unit','unit-'||$2,'America/Sao_Paulo','appointment','informal',$3::jsonb,$4::jsonb,$5::jsonb,NULL,$6,$6)
     ON CONFLICT (org_id, id) DO NOTHING`,
    [
      orgId,
      unitId,
      JSON.stringify({
        postalCode: '01310100',
        state: 'SP',
        city: 'São Paulo',
        neighborhood: 'Bela Vista',
        street: 'Avenida Paulista',
        number: '1000',
        complement: null,
      }),
      JSON.stringify({
        mode: 'appointment',
        slotMinutes: 30,
        businessHours: {
          monday: null,
          tuesday: null,
          wednesday: null,
          thursday: null,
          friday: null,
          saturday: null,
          sunday: null,
        },
        cancellationPolicy: { enabled: false, minNoticeMinutes: 120 },
        confirmationTemplates: { confirmation: '', reminder: '', cancellation: '' },
      }),
      JSON.stringify({ kind: 'informal' }),
      TS,
    ],
  )
}

async function seedService(orgId: string, serviceId: string, unitId: string): Promise<void> {
  await pool().query(
    `INSERT INTO catalog_items (org_id, id, last_event_version, kind, name, category_id, price_cents, price_visibility, active, archived_at, duration_minutes, sku, stock, gtin14, reconciliation_pending, reconciliation_last_attempt, commission, unit_ids, unit_overrides, required_resources, public_visible, created_at, updated_at)
     VALUES ($1,$2,1,'service','Service',NULL,5000,'visible',true,NULL,30,NULL,NULL,NULL,NULL,NULL,NULL,$3::jsonb,NULL,'[]'::jsonb,false,$4,$4)
     ON CONFLICT (org_id, id) DO NOTHING`,
    [orgId, serviceId, JSON.stringify([unitId]), TS],
  )
}

async function seedMembership(orgId: string, userId: string, role: Role): Promise<void> {
  await pool().query(
    `INSERT INTO memberships (org_id, id, user_id, last_event_version, role, status, rls_unit_scope, invited_by, joined_at, permissions, updated_at)
     VALUES ($1,$2,$3,1,$4,'active',NULL,NULL,$5,$6::jsonb,$5)`,
    [
      orgId,
      `${orgId}_${userId}`,
      userId,
      role,
      TS,
      JSON.stringify(defaultPermissionsForRole(role)),
    ],
  )
}

// Customer aggregate → materializes the `customers` row (appointment FK).
async function seedCustomer(orgId: string, customerId: string, userId: string): Promise<void> {
  const { CustomerConfig } = await import('@/domain/aggregates')
  const { aggregateRef, appendEvent } = await import('@/domain/effect')
  const { PostgresPersistenceLayer } = await import('@/shared/db/pg/effect/postgres-layer')
  const { Effect } = await import('effect')
  await Effect.runPromise(
    appendEvent(CustomerConfig, aggregateRef(CustomerConfig, orgId, customerId), {
      _tag: 'customer.created',
      actorId: 'test',
      payload: { data: buildStoredCustomer(customerId, orgId, userId, TS) },
    }).pipe(Effect.provide(PostgresPersistenceLayer)),
  )
}

// MemberOperation aggregate → materializes `member_operations` (appointment FK)
// + the user/membership it hangs off. Returns { proId, memberUserId }.
async function seedMemberOperation(
  orgId: string,
  unitId: string,
  serviceId: string,
): Promise<{ proId: string; memberUserId: string }> {
  const { MemberOperationConfig } = await import('@/domain/aggregates')
  const { aggregateRef, appendEvent } = await import('@/domain/effect')
  const { PostgresPersistenceLayer } = await import('@/shared/db/pg/effect/postgres-layer')
  const { Effect } = await import('effect')
  const memberUserId = uid('pro-user')
  await putUser(buildUser(memberUserId, TS, { completionCompleted: true }))
  await seedMembership(orgId, memberUserId, 'member_operator')
  const proId = uid('pro')
  await Effect.runPromise(
    appendEvent(MemberOperationConfig, aggregateRef(MemberOperationConfig, orgId, proId), {
      _tag: 'member_operation.created',
      actorId: 'test',
      payload: {
        data: {
          id: proId,
          orgId,
          userId: memberUserId,
          defaultCommission: null,
          unitIds: [unitId],
          catalogServiceIds: [serviceId],
          createdAt: TS,
          updatedAt: TS,
        },
      },
    }).pipe(Effect.provide(PostgresPersistenceLayer)),
  )
  return { proId, memberUserId }
}

// Direct INSERT of the FINAL state (completed). `member_id` is NOT NULL + FK to
// memberships but lives outside the domain type (the projector derives it), so
// it's set explicitly here.
async function seedCompletedAppointment(args: {
  orgId: string
  id: string
  unitId: string
  serviceId: string
  customerId: string
  customerUserId: string
  memberOperationId: string
  memberUserId: string
}): Promise<void> {
  await pool().query(
    `INSERT INTO appointments (org_id, id, unit_id, last_event_version, member_operation_id, member_id, customer_id, service_id, customer_user_id, start_at, end_at, status, service_price_cents_snapshot, service_duration_minutes_snapshot, created_at, updated_at)
     VALUES ($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,'completed',5000,30,$11,$11)`,
    [
      args.orgId,
      args.id,
      args.unitId,
      args.memberOperationId,
      `${args.orgId}_${args.memberUserId}`,
      args.customerId,
      args.serviceId,
      args.customerUserId,
      START,
      END,
      TS,
    ],
  )
}

// Direct INSERT of a closed order linked to the appointment.
async function seedClosedOrder(args: {
  orgId: string
  id: string
  unitId: string
  customerId: string
  appointmentId: string
  items: unknown[]
  discountCents: number
  subtotalCents: number
  totalCents: number
}): Promise<void> {
  await pool().query(
    `INSERT INTO orders (org_id, id, unit_id, last_event_version, customer_id, appointment_id, status, closed_at, payment_method, discount_cents, subtotal_cents, total_cents, items, created_at, updated_at)
     VALUES ($1,$2,$3,1,$4,$5,'closed',$6,NULL,$7,$8,$9,$10::jsonb,$6,$6)`,
    [
      args.orgId,
      args.id,
      args.unitId,
      args.customerId,
      args.appointmentId,
      TS,
      args.discountCents,
      args.subtotalCents,
      args.totalCents,
      JSON.stringify(args.items),
    ],
  )
}

function saleItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'it-1',
    kind: 'service',
    refId: 'svc-1',
    name: 'Service',
    quantity: 1,
    unitPriceCents: 5000,
    commission: null,
    attributedUserId: 'pro-u',
    coverage: 'sale',
    ...overrides,
  }
}

async function seedCompletedWithLinkedState(orgId: string): Promise<string> {
  const customerUserId = uid('cust-user')
  await seedOrg(orgId)
  await putUser(buildUser(customerUserId, TS, { completionCompleted: true }))
  await seedUnit(orgId, 'unit-1')
  await seedService(orgId, 'svc-1', 'unit-1')
  await seedCustomer(orgId, 'cust-1', customerUserId)
  const { proId, memberUserId } = await seedMemberOperation(orgId, 'unit-1', 'svc-1')
  await seedCompletedAppointment({
    orgId,
    id: 'appt-1',
    unitId: 'unit-1',
    serviceId: 'svc-1',
    customerId: 'cust-1',
    customerUserId,
    memberOperationId: proId,
    memberUserId,
  })
  // Reverse index — without it `listLinkedOrgIds` returns [] and nothing loads.
  await linkCustomerOrg(customerUserId, orgId)
  mocks.getSessionUser.mockResolvedValue({
    uid: customerUserId,
    email: null,
    displayName: null,
    picture: null,
    emailVerified: true,
  })
  return customerUserId
}

describe('loadMyAppointmentsPage — customer-history real value (#1329)', () => {
  beforeEach(async () => {
    await pool().query(`TRUNCATE ${TABLES} CASCADE`)
    vi.clearAllMocks()
  })
  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('shows "Coberto pelo plano" when the closed order was fully plan-covered', async () => {
    const orgId = uid('org')
    await seedCompletedWithLinkedState(orgId)
    await seedClosedOrder({
      orgId,
      id: 'ord-1',
      unitId: 'unit-1',
      customerId: 'cust-1',
      appointmentId: 'appt-1',
      items: [saleItem({ coverage: 'subscription', subscriptionId: 'sub-1' })],
      discountCents: 0,
      subtotalCents: 0,
      totalCents: 0,
    })

    const { past } = await loadMyAppointmentsPage()
    expect(past).toHaveLength(1)
    // The bug was showing R$ 50,00 (the price snapshot) for a R$0 experience.
    expect(past[0]?.priceLabel).toBe('Coberto pelo plano')
  })

  it('shows the real charged total for a discounted sale, not the snapshot', async () => {
    const orgId = uid('org')
    await seedCompletedWithLinkedState(orgId)
    await seedClosedOrder({
      orgId,
      id: 'ord-2',
      unitId: 'unit-1',
      customerId: 'cust-1',
      appointmentId: 'appt-1',
      items: [saleItem({ coverage: 'sale', unitPriceCents: 5000 })],
      discountCents: 1000,
      subtotalCents: 5000,
      totalCents: 4000,
    })

    const { past } = await loadMyAppointmentsPage()
    expect(past).toHaveLength(1)
    // R$ 40,00 charged (5000 − 1000), not the R$50 list price. Intl pt-BR uses a
    // non-breaking space, so match the digits.
    expect(past[0]?.priceLabel).toContain('40,00')
    expect(past[0]?.priceLabel).not.toContain('50,00')
  })

  it('keeps the price snapshot when a completed appointment has no linked order', async () => {
    const orgId = uid('org')
    await seedCompletedWithLinkedState(orgId)
    // No order seeded for appt-1.

    const { past } = await loadMyAppointmentsPage()
    expect(past).toHaveLength(1)
    // Falls back to the snapshot (R$ 50,00) — no order to derive a real value.
    expect(past[0]?.priceLabel).toContain('50,00')
  })
})
