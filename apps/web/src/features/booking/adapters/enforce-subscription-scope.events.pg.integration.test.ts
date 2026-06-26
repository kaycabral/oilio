// Postgres integration test for enforceSubscriptionScope (re-substrated to
// Postgres by the cutover, #1202).
//
// Valida que a recepção (/agenda) respeita as mesmas regras de plano que o
// self-book — brief 0019, decisão 2026-05-22 (#960/#963) que removeu o bypass
// histórico. Runs against the ephemeral `oilio` Postgres (OILIO_DATABASE_URL);
// the event-store globalSetup applies the migrations.
//
// The read chain under test: getCustomerUserId (customers table) →
// resolveCustomerSubscriptionScope (subscriptions, by customer_user_id) →
// checkBookingLimits (appointments, by customer_id). All three projections are
// seeded directly over the superuser pool (the runtime RLS shape is proven in
// the dedicated isolation suites).

import type { SubscriptionPlanSnapshot } from '@/domain'
import { closeEventStoreDb, getEventStorePool } from '@/shared/db/pg/pool'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { enforceSubscriptionScope } from './enforce-subscription-scope'

const TZ = 'America/Sao_Paulo'
const CUSTOMER_USER_ID = 'u-1'

function uniqueOrgId(label: string): string {
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

async function seedOrg(orgId: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO orgs (org_id, id, last_event_version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1,$1,1,'Org','slug-'||$1,'barbershop','owner','{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
    [orgId],
  )
}

// Parent rows the new D2/0068 cross-aggregate FKs require: subscriptions.unit_id
// → units (the seed uses 'unit-a'); appointments reference unit 'u1', professional
// 'p1' and service 's1'. Seeded over the superuser pool in beforeEach.
async function seedUnit(orgId: string, unitId: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO units (org_id, id, last_event_version, name, slug, timezone, agenda_mode, fiscal_kind, address, agenda, fiscal, created_at, updated_at)
     VALUES ($1,$2,1,'Unit','unit-'||$2,'America/Sao_Paulo','always_open','informal','{}'::jsonb,'{}'::jsonb,'{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id, id) DO NOTHING`,
    [orgId, unitId],
  )
}

async function seedProfessional(orgId: string, professionalId: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO professionals (org_id, id, last_event_version, user_id, default_commission, unit_ids, catalog_service_ids, created_at, updated_at)
     VALUES ($1,$2,1,'user-'||$2,NULL,'[]'::jsonb,'[]'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id, id) DO NOTHING`,
    [orgId, professionalId],
  )
}

async function seedService(orgId: string, serviceId: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO catalog_items (org_id, id, last_event_version, kind, name, category_id, price_cents, price_visibility, active, archived_at, duration_minutes, sku, stock, gtin14, reconciliation_pending, reconciliation_last_attempt, commission, unit_ids, unit_overrides, required_resources, public_visible, created_at, updated_at)
     VALUES ($1,$2,1,'service','Service',NULL,5000,'visible',true,NULL,30,NULL,NULL,NULL,NULL,NULL,NULL,'[]'::jsonb,NULL,NULL,false,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id, id) DO NOTHING`,
    [orgId, serviceId],
  )
}

async function seedCustomer(orgId: string, customerId: string, userId: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO customers (org_id, id, last_event_version, user_id, archived_at, deactivated_at, created_at, updated_at)
     VALUES ($1,$2,1,$3,NULL,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
    [orgId, customerId, userId],
  )
}

async function seedSubscription(
  orgId: string,
  customerId: string,
  customerUserId: string,
  plan: SubscriptionPlanSnapshot,
): Promise<void> {
  const now = new Date().toISOString()
  const currentPeriod = { startAt: now, endAt: '2099-01-01T00:00:00.000Z', consumed: 0 }
  await getEventStorePool().query(
    `INSERT INTO subscriptions (org_id, id, unit_id, last_event_version, customer_id, customer_user_id, status, billing_cycle, cancel_at_period_end, next_charge_date, past_due_cycles, past_due_threshold, cancellation_reason, cancelled_at, plan, current_period, created_at, updated_at)
     VALUES ($1,$2,'unit-a',1,$3,$4,'active',$5,false,NULL,0,2,NULL,NULL,$6::jsonb,$7::jsonb,$8,$8)`,
    [
      orgId,
      'sub-1',
      customerId,
      customerUserId,
      plan.billingCycle,
      JSON.stringify(plan),
      JSON.stringify(currentPeriod),
      now,
    ],
  )
}

async function seedAppointment(
  orgId: string,
  appt: { id: string; customerId: string; startAt: string },
): Promise<void> {
  const now = new Date().toISOString()
  const startMs = new Date(appt.startAt).getTime()
  const endAt = new Date(startMs + 30 * 60_000).toISOString()
  await getEventStorePool().query(
    `INSERT INTO appointments (org_id, id, unit_id, last_event_version, professional_id, customer_id, service_id, customer_user_id, professional_user_id, start_at, end_at, status, service_price_cents_snapshot, service_duration_minutes_snapshot, commission_snapshot, cancellation_policy_snapshot, tracking, created_at, updated_at)
     VALUES ($1,$2,'u1',1,'p1',$3,'s1',$4,NULL,$5,$6,'scheduled',5000,30,NULL,NULL,NULL,$7,$7)`,
    [orgId, appt.id, appt.customerId, CUSTOMER_USER_ID, appt.startAt, endAt, now],
  )
}

describe('enforceSubscriptionScope — Postgres', () => {
  let orgId: string

  beforeEach(async () => {
    await getEventStorePool().query(
      'TRUNCATE appointments, subscriptions, customers, catalog_items, professionals, units, orgs CASCADE',
    )
    orgId = uniqueOrgId('scope')
    await seedOrg(orgId)
    await seedUnit(orgId, 'unit-a')
    await seedUnit(orgId, 'u1')
    await seedProfessional(orgId, 'p1')
    await seedService(orgId, 's1')
  })

  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('passa quando cliente não tem subscription ativa', async () => {
    await seedCustomer(orgId, 'c1', CUSTOMER_USER_ID)
    const res = await enforceSubscriptionScope({
      orgId,
      orgTimezone: TZ,
      customerId: 'c1',
      unitId: 'u-any',
      startAt: '2026-08-15T13:00:00.000Z',
    })
    expect(res).toEqual({ ok: true })
  })

  it('bloqueia quando unit fora do unitAllowlist', async () => {
    await seedCustomer(orgId, 'c1', CUSTOMER_USER_ID)
    await seedSubscription(
      orgId,
      'c1',
      CUSTOMER_USER_ID,
      buildPlanSnapshot({ unitAllowlist: ['u-permitida'] }),
    )
    const res = await enforceSubscriptionScope({
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
    await seedCustomer(orgId, 'c1', CUSTOMER_USER_ID)
    await seedSubscription(
      orgId,
      'c1',
      CUSTOMER_USER_ID,
      buildPlanSnapshot({ unitAllowlist: ['u-permitida'] }),
    )
    const res = await enforceSubscriptionScope({
      orgId,
      orgTimezone: TZ,
      customerId: 'c1',
      unitId: 'u-permitida',
      startAt: '2026-08-15T13:00:00.000Z',
    })
    expect(res).toEqual({ ok: true })
  })

  it('bloqueia ao bater maxPerDay', async () => {
    await seedCustomer(orgId, 'c1', CUSTOMER_USER_ID)
    await seedSubscription(
      orgId,
      'c1',
      CUSTOMER_USER_ID,
      buildPlanSnapshot({ bookingLimits: { maxPerDay: 1 } }),
    )
    await seedAppointment(orgId, {
      id: 'a-existing',
      customerId: 'c1',
      startAt: '2026-08-15T13:00:00.000Z',
    })
    const res = await enforceSubscriptionScope({
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
    await seedCustomer(orgId, 'c1', CUSTOMER_USER_ID)
    await seedSubscription(
      orgId,
      'c1',
      CUSTOMER_USER_ID,
      buildPlanSnapshot({ bookingLimits: { maxPerDay: 1 } }),
    )
    await seedAppointment(orgId, {
      id: 'a-moving',
      customerId: 'c1',
      startAt: '2026-08-15T13:00:00.000Z',
    })
    const res = await enforceSubscriptionScope({
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
