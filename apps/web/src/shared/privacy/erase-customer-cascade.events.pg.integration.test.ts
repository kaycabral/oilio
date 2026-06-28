import type { AppointmentStatus, ChargeStatus, SubscriptionStatus } from '@/domain'
import { AppointmentConfig } from '@/domain/aggregates/appointment/config'
import { ChargeConfig } from '@/domain/aggregates/charge/config'
import { aggregateRef } from '@/domain/effect'
import {
  APPOINTMENT_COLUMNS,
  appointmentColumnValues,
} from '@/shared/db/pg/effect/appointment-projector'
import { CHARGE_COLUMNS, chargeColumnValues } from '@/shared/db/pg/effect/charge-projector'
import {
  SUBSCRIPTION_COLUMNS,
  subscriptionColumnValues,
} from '@/shared/db/pg/effect/subscription-projector'
import { closeEventStoreDb, getEventStorePool } from '@/shared/db/pg/pool'
import { buildAppointment, buildCharge, buildSubscription } from '@/shared/fixtures/domain-builders'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eraseCustomerCascadeInOrg, hasActiveSubscriptionInOrg } from './erase-customer-cascade'

/**
 * CUSTOMER erasure cascade against REAL Postgres (brief 0032 / #1101, AC-12 +
 * AC-14 — the rewrite of the Firestore-emulator `erase-customer-cascade.
 * integration.test.ts`). The cascade cancels the active subscription immediately,
 * stops its pending (`scheduled`/`recovering`) charges, and cancels future
 * appointments; past records (paid charges, past appointments) are LEFT. Each
 * step is idempotent (re-running over already-terminal records is a no-op).
 *
 * The production reads run under `readUnderRls` and the cancels through
 * `emitEvent`, both over the event-store pool (superuser locally/CI → RLS
 * bypassed; the RLS policies themselves are proven in the dedicated isolation
 * specs). Preconditions are seeded as typed projection rows via the projector
 * column-value mappers + the shared domain builders, so each `*.cancelled` event
 * reads a valid prior projection doc and reprojects the terminal state.
 *
 * Per-run-unique org/user ids (Date.now + counter) — no global wipe between
 * cases (TRUNCATE only resets the typed tables for the file).
 */

const TS = '2026-06-01T12:00:00.000Z'

let seq = 0
function uniqueId(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now()}-${seq}`
}

const chargeRef = (orgId: string, id: string) => aggregateRef(ChargeConfig, orgId, id)
const apptRef = (orgId: string, id: string) => aggregateRef(AppointmentConfig, orgId, id)

async function insertRow(
  table: string,
  columns: readonly string[],
  values: unknown[],
): Promise<void> {
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ')
  // appointments/agenda_blocks carry `member_id` (brief 0076 AC-04) DERIVED from
  // the operational profile via a correlated subquery on `member_operation_id` —
  // mirroring the projectors. The column lists passed in (APPOINTMENT_COLUMNS /
  // AGENDA_BLOCK_COLUMNS) omit it, so append it here.
  if (table === 'appointments' || table === 'agenda_blocks') {
    const orgIdRef = `$${columns.indexOf('org_id') + 1}`
    const memberOpIdRef = `$${columns.indexOf('member_operation_id') + 1}`
    const memberIdDerived = `(SELECT mo.member_id FROM member_operations mo WHERE mo.org_id = ${orgIdRef} AND mo.id = ${memberOpIdRef})`
    await getEventStorePool().query(
      `INSERT INTO ${table} (${[...columns, 'member_id'].join(', ')}) VALUES (${placeholders}, ${memberIdDerived})`,
      values,
    )
    return
  }
  await getEventStorePool().query(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
    values,
  )
}

// Idempotent FK-parent seeds (brief 0068 D2). The child projections carry
// composite FKs into orgs/units/customers/memberOperations/catalog_items; a case may
// seed several children sharing the same parent, so each is `ON CONFLICT DO
// NOTHING`.
async function seedOrg(orgId: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO orgs (org_id, id, last_event_version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1,$1,1,'Org','slug-'||$1,'barbershop','owner','{}'::jsonb,$2,$2)
     ON CONFLICT (org_id) DO NOTHING`,
    [orgId, TS],
  )
}

async function seedUnit(orgId: string, unitId: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO units (org_id, id, last_event_version, name, slug, timezone, agenda_mode, fiscal_kind, address, agenda, fiscal, created_at, updated_at)
     VALUES ($1,$2,1,'Unit','unit-'||$2,'America/Sao_Paulo','always_open','informal','{}'::jsonb,'{}'::jsonb,'{}'::jsonb,$3,$3)
     ON CONFLICT (org_id, id) DO NOTHING`,
    [orgId, unitId, TS],
  )
}

async function seedCustomer(orgId: string, customerId: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO customers (org_id, id, last_event_version, user_id, archived_at, deactivated_at, created_at, updated_at)
     VALUES ($1,$2,1,'user-'||$2,NULL,NULL,$3,$3)
     ON CONFLICT (org_id, id) DO NOTHING`,
    [orgId, customerId, TS],
  )
}

async function seedMemberOperation(orgId: string, memberOperationId: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO memberships (org_id, id, user_id, last_event_version, role, status, joined_at, permissions, updated_at)
     VALUES ($1,$1||'_'||('user-'||$2),'user-'||$2,1,'member_operator','active',$3,'{}'::jsonb,$3)
     ON CONFLICT (org_id, id) DO NOTHING`,
    [orgId, memberOperationId, TS],
  )
  await getEventStorePool().query(
    `INSERT INTO member_operations (org_id, id, last_event_version, user_id, member_id, default_commission, unit_ids, catalog_service_ids, created_at, updated_at)
     VALUES ($1,$2,1,'user-'||$2,$1||'_'||('user-'||$2),NULL,'[]'::jsonb,'[]'::jsonb,$3,$3)
     ON CONFLICT (org_id, id) DO NOTHING`,
    [orgId, memberOperationId, TS],
  )
}

async function seedService(orgId: string, serviceId: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO catalog_items (org_id, id, last_event_version, kind, name, category_id, price_cents, price_visibility, active, archived_at, duration_minutes, sku, stock, gtin14, reconciliation_pending, reconciliation_last_attempt, commission, unit_ids, unit_overrides, required_resources, public_visible, created_at, updated_at)
     VALUES ($1,$2,1,'service','Service',NULL,5000,'visible',true,NULL,30,NULL,NULL,NULL,NULL,NULL,NULL,'[]'::jsonb,NULL,NULL,false,$3,$3)
     ON CONFLICT (org_id, id) DO NOTHING`,
    [orgId, serviceId, TS],
  )
}

async function seedSubscription(
  orgId: string,
  customerUserId: string,
  status: SubscriptionStatus,
): Promise<string> {
  const id = uniqueId('sub')
  const customerId = uniqueId('cust')
  const sub = buildSubscription(id, orgId, TS, {
    customerUserId,
    customerId,
    status,
  })
  // FK parents: subscription.org_id → orgs, unit_id → units ('unit' default),
  // customer_id → customers.
  await seedOrg(orgId)
  await seedUnit(orgId, 'unit')
  await seedCustomer(orgId, customerId)
  await insertRow('subscriptions', SUBSCRIPTION_COLUMNS, subscriptionColumnValues(sub, 1))
  return id
}

async function seedCharge(
  orgId: string,
  subscriptionId: string,
  status: ChargeStatus,
): Promise<string> {
  const id = uniqueId('charge')
  const charge = buildCharge(id, orgId, TS, { subscriptionId, status })
  // FK parents: charge.org_id → orgs, customer_id → customers ('cust' default).
  // subscription_id → subscriptions is DEFERRABLE and the row already exists
  // (seedSubscription ran first).
  await seedOrg(orgId)
  await seedCustomer(orgId, charge.customerId)
  await insertRow('charges', CHARGE_COLUMNS, chargeColumnValues(charge, chargeRef(orgId, id), 1))
  return id
}

async function seedAppointment(
  orgId: string,
  customerUserId: string,
  startAt: string,
  status: AppointmentStatus,
): Promise<string> {
  const id = uniqueId('appt')
  const appt = buildAppointment(id, orgId, TS, {
    startAt,
    endAt: startAt,
    status,
    customerUserId,
  })
  // FK parents: appointment.org_id → orgs, unit_id → units, member_operation_id →
  // memberOperations, customer_id → customers, service_id → catalog_items. The
  // builder defaults are unit 'unit', memberOperation 'pro', customer 'cust',
  // service 'svc'.
  await seedOrg(orgId)
  await seedUnit(orgId, appt.unitId)
  await seedMemberOperation(orgId, appt.memberOperationId)
  await seedCustomer(orgId, appt.customerId)
  await seedService(orgId, appt.serviceId)
  await insertRow(
    'appointments',
    APPOINTMENT_COLUMNS,
    appointmentColumnValues(appt, apptRef(orgId, id), 1),
  )
  return id
}

const future = () => new Date(Date.now() + 86_400_000).toISOString()
const past = () => new Date(Date.now() - 86_400_000).toISOString()

async function statusOf(table: string, orgId: string, id: string): Promise<string | undefined> {
  const res = await getEventStorePool().query<{ status: string }>(
    `SELECT status FROM ${table} WHERE org_id = $1 AND id = $2`,
    [orgId, id],
  )
  return res.rows[0]?.status
}

describe('eraseCustomerCascadeInOrg (Postgres)', () => {
  beforeEach(async () => {
    await getEventStorePool().query(
      'TRUNCATE events, projections, subscriptions, charges, appointments, units, customers, member_operations, catalog_items, orgs CASCADE',
    )
  })
  afterAll(async () => {
    await closeEventStoreDb()
  })

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

    expect(await statusOf('subscriptions', orgId, subId)).toBe('cancelled')
    expect(await statusOf('charges', orgId, scheduledCharge)).toBe('cancelled')
    expect(await statusOf('charges', orgId, recoveringCharge)).toBe('cancelled')
    // Past (paid) charge retained, untouched.
    expect(await statusOf('charges', orgId, paidCharge)).toBe('paid')
    // Future appointment cancelled, past one retained.
    expect(await statusOf('appointments', orgId, futureAppt)).toBe('cancelled')
    expect(await statusOf('appointments', orgId, pastAppt)).toBe('scheduled')
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
