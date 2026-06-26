import type { MembershipStatus, SubscriptionStatus } from '@/domain'
import {
  APPOINTMENT_COLUMNS,
  appointmentColumnValues,
} from '@/shared/db/pg/effect/appointment-projector'
import {
  SUBSCRIPTION_COLUMNS,
  subscriptionColumnValues,
} from '@/shared/db/pg/effect/subscription-projector'
import { closeEventStoreDb, getEventStorePool } from '@/shared/db/pg/pool'
import {
  buildAppointment,
  buildMembership,
  buildSubscription,
} from '@/shared/fixtures/domain-builders'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  attachCanDelete,
  canDeleteCatalogItem,
  canDeleteCustomer,
  canDeletePlan,
  canDeleteProfessional,
  canDeleteUnit,
  getCustomerDeletionImpact,
} from './delete-guard'

/**
 * Active-reference delete guard against REAL Postgres (brief 0033, AC-01/AC-02 —
 * the rewrite of the Firestore-emulator `delete-guard.integration.test.ts`).
 * Proves the core business rule the `delete-guard.ts` module owns: an ACTIVE
 * reference blocks the hard-delete (`canDelete=false`); a HISTORICAL/snapshotted
 * reference does NOT (`canDelete=true`). Covers every entity the module guards:
 * subscription-plan, catalog-item, unit, professional, customer (+ the
 * `getCustomerDeletionImpact` / `attachCanDelete` consumers).
 *
 * The guard reads run under `readUnderRls` over the event-store pool (superuser
 * locally/CI → RLS bypassed; the policies are proven in the isolation specs).
 * Preconditions are seeded as typed projection rows (subscriptions/appointments
 * via the projector column mappers + domain builders; orders/professionals/
 * memberships via raw INSERT matching the schema). Per-run-unique org ids isolate
 * each case; no global wipe.
 */

const TS = '2026-06-01T12:00:00.000Z'

let seq = 0
function uniqueOrg(): string {
  seq += 1
  return `delguard-${Date.now()}-${seq}`
}
function uid(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now()}-${seq}`
}

const future = () => new Date(Date.now() + 86_400_000).toISOString()
const past = () => new Date(Date.now() - 86_400_000).toISOString()

async function insertRow(
  table: string,
  columns: readonly string[],
  values: unknown[],
): Promise<void> {
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ')
  await getEventStorePool().query(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
    values,
  )
}

async function seedSubscription(
  orgId: string,
  opts: {
    status: SubscriptionStatus
    planId?: string
    includedItemIds?: string[]
    customerId?: string
    planName?: string
    periodEndAt?: string
  },
): Promise<void> {
  const id = uid('sub')
  const customerId = opts.customerId ?? 'cust'
  const sub = buildSubscription(id, orgId, TS, {
    status: opts.status,
    customerId,
    plan: {
      planId: opts.planId ?? 'unused',
      name: opts.planName ?? 'Plano X',
      includedItemIds: opts.includedItemIds ?? [],
    },
    currentPeriod: { startAt: past(), endAt: opts.periodEndAt ?? future(), consumed: 0 },
  })
  // FK parents (brief 0068 D2): subscription.org_id → orgs, unit_id → units,
  // customer_id → customers. `buildSubscription` defaults unit_id to 'unit'.
  await seedOrg(orgId)
  await seedUnit(orgId, 'unit')
  await seedCustomer(orgId, customerId)
  await insertRow(
    'subscriptions',
    SUBSCRIPTION_COLUMNS,
    subscriptionColumnValues(sub, `orgs/${orgId}/subscriptions/${id}`, 1),
  )
}

// Appointment with a ZERO-WIDTH interval (endAt == startAt) so the anti-double-
// book exclusion constraint never trips when several are seeded in one case.
async function seedAppointment(
  orgId: string,
  opts: {
    status: 'scheduled' | 'completed' | 'cancelled'
    startAt: string
    unitId?: string
    professionalId?: string
    customerId?: string
  },
): Promise<void> {
  const id = uid('appt')
  const unitId = opts.unitId ?? 'unit'
  const professionalId = opts.professionalId ?? 'pro'
  const customerId = opts.customerId ?? 'cust'
  const appt = buildAppointment(id, orgId, TS, {
    status: opts.status,
    startAt: opts.startAt,
    endAt: opts.startAt,
    unitId,
    professionalId,
    customerId,
  })
  // FK parents (brief 0068 D2): appointment.org_id → orgs, unit_id → units,
  // professional_id → professionals, customer_id → customers, service_id →
  // catalog_items. `buildAppointment` defaults service_id to 'svc'.
  await seedOrg(orgId)
  await seedUnit(orgId, unitId)
  await seedProfessionalRow(orgId, professionalId)
  await seedCustomer(orgId, customerId)
  await seedService(orgId, 'svc')
  await insertRow(
    'appointments',
    APPOINTMENT_COLUMNS,
    appointmentColumnValues(appt, `orgs/${orgId}/appointments/${id}`, 1),
  )
}

async function seedOrder(
  orgId: string,
  opts: { status: 'open' | 'closed' | 'cancelled'; refId?: string; customerId?: string },
): Promise<void> {
  const id = uid('order')
  const items = opts.refId
    ? JSON.stringify([
        {
          id: 'i1',
          kind: 'service',
          refId: opts.refId,
          name: 'Item X',
          quantity: 1,
          unitPriceCents: 0,
          commission: null,
          attributedUserId: null,
        },
      ])
    : '[]'
  const closedAt = opts.status === 'closed' ? TS : null
  const paymentMethod = opts.status === 'closed' ? 'cash' : null
  const customerId = opts.customerId ?? 'cust'
  // FK parents (brief 0068 D2): order.org_id → orgs, unit_id → units,
  // customer_id → customers. `seedOrder` writes unit_id 'unit'.
  await seedOrg(orgId)
  await seedUnit(orgId, 'unit')
  await seedCustomer(orgId, customerId)
  await getEventStorePool().query(
    `INSERT INTO orders (aggregate_path, org_id, id, unit_id, version, customer_id, appointment_id, status, closed_at, payment_method, discount_cents, subtotal_cents, total_cents, items, created_at, updated_at)
     VALUES ($1,$2,$3,'unit',1,$4,NULL,$5,$6,$7,0,0,0,$8::jsonb,$9,$9)`,
    [
      `orgs/${orgId}/orders/${id}`,
      orgId,
      id,
      customerId,
      opts.status,
      closedAt,
      paymentMethod,
      items,
      TS,
    ],
  )
}

// Seeds the parent `orgs` row idempotently. `professionals.org_id` carries a FK
// to `orgs(org_id)` (the org-folder projection), so a professional cannot be
// inserted before its org exists — unlike subscriptions/appointments/orders,
// which have no such FK. Idempotent: a case may seed several professionals under
// the same org.
async function seedOrg(orgId: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO orgs (aggregate_path, org_id, id, version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1,$2,$2,1,'Org X',$3,'other',$4,'{}'::jsonb,$5,$5)
     ON CONFLICT (aggregate_path) DO NOTHING`,
    [`orgs/${orgId}`, orgId, `slug-${orgId}`, uid('owner'), TS],
  )
}

// Idempotent FK-parent seeds (brief 0068 D2). The child projections
// (subscriptions/appointments/orders) carry composite FKs into these tables; a
// case may seed several children sharing the same unit/customer/professional/
// service, so each is `ON CONFLICT DO NOTHING`.
async function seedUnit(orgId: string, unitId: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO units (aggregate_path, org_id, id, version, name, slug, timezone, agenda_mode, fiscal_kind, address, agenda, fiscal, created_at, updated_at)
     VALUES ($1,$2,$3,1,'Unit','unit-'||$3,'America/Sao_Paulo','always_open','informal','{}'::jsonb,'{}'::jsonb,'{}'::jsonb,$4,$4)
     ON CONFLICT (aggregate_path) DO NOTHING`,
    [`orgs/${orgId}/units/${unitId}`, orgId, unitId, TS],
  )
}

async function seedCustomer(orgId: string, customerId: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO customers (aggregate_path, org_id, id, version, user_id, archived_at, deactivated_at, created_at, updated_at)
     VALUES ($1,$2,$3,1,'user-'||$3,NULL,NULL,$4,$4)
     ON CONFLICT (aggregate_path) DO NOTHING`,
    [`orgs/${orgId}/customers/${customerId}`, orgId, customerId, TS],
  )
}

async function seedService(orgId: string, serviceId: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO catalog_items (aggregate_path, org_id, id, version, kind, name, category_id, price_cents, price_visibility, active, archived_at, duration_minutes, sku, stock, gtin14, reconciliation_pending, reconciliation_last_attempt, commission, unit_ids, unit_overrides, required_resources, public_visible, created_at, updated_at)
     VALUES ($1,$2,$3,1,'service','Service',NULL,5000,'visible',true,NULL,30,NULL,NULL,NULL,NULL,NULL,NULL,'[]'::jsonb,NULL,NULL,false,$4,$4)
     ON CONFLICT (aggregate_path) DO NOTHING`,
    [`orgs/${orgId}/catalog_items/${serviceId}`, orgId, serviceId, TS],
  )
}

// Idempotent professional parent for the appointment FK (distinct from
// `seedProfessional`, which mints a fresh non-idempotent professional and returns
// its id for the canDeleteProfessional cases).
async function seedProfessionalRow(orgId: string, professionalId: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO professionals (aggregate_path, org_id, id, version, user_id, default_commission, unit_ids, catalog_service_ids, created_at, updated_at)
     VALUES ($1,$2,$3,1,'user-'||$3,NULL,'[]'::jsonb,'[]'::jsonb,$4,$4)
     ON CONFLICT (aggregate_path) DO NOTHING`,
    [`orgs/${orgId}/professionals/${professionalId}`, orgId, professionalId, TS],
  )
}

// Professional projection carrying a `userId` link + optional unit scope. Returns
// the professional DOC id.
async function seedProfessional(
  orgId: string,
  opts: { userId?: string; unitIds?: string[] } = {},
): Promise<string> {
  await seedOrg(orgId)
  const id = uid('pro')
  const unitIds = opts.unitIds ?? []
  await getEventStorePool().query(
    `INSERT INTO professionals (aggregate_path, org_id, id, version, user_id, default_commission, unit_ids, catalog_service_ids, created_at, updated_at)
     VALUES ($1,$2,$3,1,$4,NULL,$5::jsonb,'[]'::jsonb,$6,$6)`,
    [
      `orgs/${orgId}/professionals/${id}`,
      orgId,
      id,
      opts.userId ?? uid('u'),
      JSON.stringify(unitIds),
      TS,
    ],
  )
  // Seeding professionals directly (not via the projector) must also populate the
  // `professional_units` join table — `canDeleteUnit` now reads it (brief 0068 D3).
  // The unit row is required by the join's composite FK to units(org_id, id).
  for (const unitId of unitIds) {
    await getEventStorePool().query(
      `INSERT INTO units (aggregate_path, org_id, id, version, name, slug, timezone, agenda_mode, fiscal_kind, address, agenda, fiscal, created_at, updated_at)
       VALUES ('orgs/'||$1||'/units/'||$2,$1,$2,1,'Unit','unit-'||$2,'America/Sao_Paulo','always_open','informal','{}'::jsonb,'{}'::jsonb,'{}'::jsonb,$3,$3)
       ON CONFLICT (aggregate_path) DO NOTHING`,
      [orgId, unitId, TS],
    )
    await getEventStorePool().query(
      `INSERT INTO professional_units (org_id, professional_id, unit_id) VALUES ($1,$2,$3)
       ON CONFLICT DO NOTHING`,
      [orgId, id, unitId],
    )
  }
  return id
}

async function seedMembership(
  orgId: string,
  userId: string,
  status: MembershipStatus,
): Promise<void> {
  const m = buildMembership(orgId, userId, TS, { status })
  await getEventStorePool().query(
    `INSERT INTO memberships (aggregate_path, org_id, id, user_id, version, role, status, rls_unit_scope, invited_by, joined_at, permissions, updated_at)
     VALUES ($1,$2,$3,$4,1,$5,$6,NULL,NULL,$7,$8::jsonb,$7)`,
    [`memberships/${m.id}`, orgId, m.id, userId, m.role, status, TS, JSON.stringify(m.permissions)],
  )
}

const TABLES =
  'subscriptions, appointments, orders, professionals, memberships, units, customers, catalog_items, orgs'

describe('canDeletePlan — active vs historical subscription', () => {
  beforeEach(async () => {
    await getEventStorePool().query(`TRUNCATE ${TABLES} CASCADE`)
  })
  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('no reference → deletable', async () => {
    const t = uniqueOrg()
    expect(await canDeletePlan(t, uid('plan'))).toBe(true)
  })

  it('active subscription → blocked', async () => {
    const t = uniqueOrg()
    const planId = uid('plan')
    await seedSubscription(t, { planId, status: 'active' })
    expect(await canDeletePlan(t, planId)).toBe(false)
  })

  it('only a cancelled (historical) subscription → still deletable', async () => {
    const t = uniqueOrg()
    const planId = uid('plan')
    await seedSubscription(t, { planId, status: 'cancelled' })
    await seedSubscription(t, { planId, status: 'cancelled_for_non_payment' })
    expect(await canDeletePlan(t, planId)).toBe(true)
  })
})

describe('canDeleteCatalogItem — open order / active coverage vs historical', () => {
  beforeEach(async () => {
    await getEventStorePool().query(`TRUNCATE ${TABLES} CASCADE`)
  })
  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('no reference → deletable', async () => {
    const t = uniqueOrg()
    expect(await canDeleteCatalogItem(t, uid('item'))).toBe(true)
  })

  it('open order referencing it → blocked', async () => {
    const t = uniqueOrg()
    const itemId = uid('item')
    await seedOrder(t, { status: 'open', refId: itemId })
    expect(await canDeleteCatalogItem(t, itemId)).toBe(false)
  })

  it('only closed/cancelled orders (historical) → still deletable', async () => {
    const t = uniqueOrg()
    const itemId = uid('item')
    await seedOrder(t, { status: 'closed', refId: itemId })
    await seedOrder(t, { status: 'cancelled', refId: itemId })
    expect(await canDeleteCatalogItem(t, itemId)).toBe(true)
  })

  it('active subscription covering it → blocked', async () => {
    const t = uniqueOrg()
    const itemId = uid('item')
    await seedSubscription(t, { includedItemIds: [itemId], status: 'active' })
    expect(await canDeleteCatalogItem(t, itemId)).toBe(false)
  })

  it('only a cancelled subscription covering it (historical) → still deletable', async () => {
    const t = uniqueOrg()
    const itemId = uid('item')
    await seedSubscription(t, { includedItemIds: [itemId], status: 'cancelled' })
    expect(await canDeleteCatalogItem(t, itemId)).toBe(true)
  })
})

describe('canDeleteUnit — active pro / future appointment vs historical', () => {
  beforeEach(async () => {
    await getEventStorePool().query(`TRUNCATE ${TABLES} CASCADE`)
  })
  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('no reference → deletable', async () => {
    const t = uniqueOrg()
    expect(await canDeleteUnit(t, uid('unit'))).toBe(true)
  })

  it('professional scoped to the unit → blocked', async () => {
    const t = uniqueOrg()
    const unitId = uid('unit')
    await seedProfessional(t, { unitIds: [unitId] })
    expect(await canDeleteUnit(t, unitId)).toBe(false)
  })

  it('future scheduled appointment → blocked', async () => {
    const t = uniqueOrg()
    const unitId = uid('unit')
    await seedAppointment(t, { unitId, status: 'scheduled', startAt: future() })
    expect(await canDeleteUnit(t, unitId)).toBe(false)
  })

  it('only past/completed/cancelled appointments (historical) → still deletable', async () => {
    const t = uniqueOrg()
    const unitId = uid('unit')
    await seedAppointment(t, { unitId, status: 'scheduled', startAt: past() })
    await seedAppointment(t, { unitId, status: 'completed', startAt: future() })
    await seedAppointment(t, { unitId, status: 'cancelled', startAt: future() })
    expect(await canDeleteUnit(t, unitId)).toBe(true)
  })
})

describe('attachCanDelete — per-row precompute (AC-03)', () => {
  beforeEach(async () => {
    await getEventStorePool().query(`TRUNCATE ${TABLES} CASCADE`)
  })
  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('attaches the reference-based flag per row', async () => {
    const t = uniqueOrg()
    const free = uid('plan')
    const used = uid('plan')
    await seedSubscription(t, { planId: used, status: 'active' })

    const rows = await attachCanDelete([{ id: free }, { id: used }], (id) =>
      canDeletePlan(t, id).then((v) => !v),
    )
    expect(rows.find((r) => r.id === free)?.canDelete).toBe(true)
    expect(rows.find((r) => r.id === used)?.canDelete).toBe(false)
  })
})

describe('canDeleteProfessional — future appointment / active membership vs historical', () => {
  beforeEach(async () => {
    await getEventStorePool().query(`TRUNCATE ${TABLES} CASCADE`)
  })
  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('no reference (revoked membership, no future appt) → deletable', async () => {
    const t = uniqueOrg()
    const u = uid('u')
    const proId = await seedProfessional(t, { userId: u })
    await seedMembership(t, u, 'revoked')
    expect(await canDeleteProfessional(t, proId)).toBe(true)
  })

  it('professional doc absent → deletable (nothing to orphan)', async () => {
    const t = uniqueOrg()
    expect(await canDeleteProfessional(t, 'ghost')).toBe(true)
  })

  it('active membership → blocked', async () => {
    const t = uniqueOrg()
    const u = uid('u')
    const proId = await seedProfessional(t, { userId: u })
    await seedMembership(t, u, 'active')
    expect(await canDeleteProfessional(t, proId)).toBe(false)
  })

  it('suspended membership (0029 deactivation, reversible) → still blocked', async () => {
    const t = uniqueOrg()
    const u = uid('u')
    const proId = await seedProfessional(t, { userId: u })
    await seedMembership(t, u, 'suspended')
    expect(await canDeleteProfessional(t, proId)).toBe(false)
  })

  it('future scheduled appointment → blocked even after offboarding', async () => {
    const t = uniqueOrg()
    const u = uid('u')
    const proId = await seedProfessional(t, { userId: u })
    await seedMembership(t, u, 'revoked')
    await seedAppointment(t, { professionalId: proId, status: 'scheduled', startAt: future() })
    expect(await canDeleteProfessional(t, proId)).toBe(false)
  })

  it('only past/completed/cancelled appointments + revoked membership (historical) → deletable', async () => {
    const t = uniqueOrg()
    const u = uid('u')
    const proId = await seedProfessional(t, { userId: u })
    await seedMembership(t, u, 'revoked')
    await seedAppointment(t, { professionalId: proId, status: 'scheduled', startAt: past() })
    await seedAppointment(t, { professionalId: proId, status: 'completed', startAt: future() })
    await seedAppointment(t, { professionalId: proId, status: 'cancelled', startAt: future() })
    expect(await canDeleteProfessional(t, proId)).toBe(true)
  })
})

// Operator delete (brief 0033, AC-07): the ONLY hard blocker is an open comanda.
// Active subscription + future appointments NO LONGER block — they cascade-cancel
// and surface in `getCustomerDeletionImpact`.
describe('canDeleteCustomer — only an open comanda blocks', () => {
  beforeEach(async () => {
    await getEventStorePool().query(`TRUNCATE ${TABLES} CASCADE`)
  })
  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('no reference → deletable', async () => {
    const t = uniqueOrg()
    expect(await canDeleteCustomer(t, uid('c'))).toBe(true)
  })

  it('open comanda → blocked', async () => {
    const t = uniqueOrg()
    const cid = uid('c')
    await seedOrder(t, { customerId: cid, status: 'open' })
    expect(await canDeleteCustomer(t, cid)).toBe(false)
  })

  it('future appointment → NOT blocked (cascade cancels it)', async () => {
    const t = uniqueOrg()
    const cid = uid('c')
    await seedAppointment(t, { customerId: cid, status: 'scheduled', startAt: future() })
    expect(await canDeleteCustomer(t, cid)).toBe(true)
  })

  it('active subscription → NOT blocked (cascade cancels it)', async () => {
    const t = uniqueOrg()
    const cid = uid('c')
    await seedSubscription(t, { customerId: cid, status: 'active' })
    expect(await canDeleteCustomer(t, cid)).toBe(true)
  })

  it('only historical refs (closed/cancelled order, past appt, cancelled sub) → deletable', async () => {
    const t = uniqueOrg()
    const cid = uid('c')
    await seedOrder(t, { customerId: cid, status: 'closed' })
    await seedOrder(t, { customerId: cid, status: 'cancelled' })
    await seedAppointment(t, { customerId: cid, status: 'cancelled', startAt: future() })
    await seedSubscription(t, { customerId: cid, status: 'cancelled' })
    expect(await canDeleteCustomer(t, cid)).toBe(true)
  })
})

describe('getCustomerDeletionImpact — what removing the customer affects', () => {
  beforeEach(async () => {
    await getEventStorePool().query(`TRUNCATE ${TABLES} CASCADE`)
  })
  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('no footprint → zeros + hasFootprint false', async () => {
    const t = uniqueOrg()
    const impact = await getCustomerDeletionImpact(t, uid('c'))
    expect(impact).toEqual({
      openComandas: 0,
      activeSubscription: null,
      futureAppointments: 0,
      hasFootprint: false,
    })
  })

  it('active sub + future appts → listed; open comanda counted; hasFootprint true', async () => {
    const t = uniqueOrg()
    const cid = uid('c')
    const due = future()
    await seedSubscription(t, {
      customerId: cid,
      status: 'active',
      planName: 'Plano Básico',
      periodEndAt: due,
    })
    await seedAppointment(t, { customerId: cid, status: 'scheduled', startAt: future() })
    await seedAppointment(t, { customerId: cid, status: 'scheduled', startAt: future() })
    await seedOrder(t, { customerId: cid, status: 'open' })
    const impact = await getCustomerDeletionImpact(t, cid)
    expect(impact.openComandas).toBe(1)
    expect(impact.activeSubscription).toEqual({ planName: 'Plano Básico', periodEndAt: due })
    expect(impact.futureAppointments).toBe(2)
    expect(impact.hasFootprint).toBe(true)
  })

  it('only historical footprint → hasFootprint true, nothing active', async () => {
    const t = uniqueOrg()
    const cid = uid('c')
    await seedOrder(t, { customerId: cid, status: 'closed' })
    const impact = await getCustomerDeletionImpact(t, cid)
    expect(impact).toEqual({
      openComandas: 0,
      activeSubscription: null,
      futureAppointments: 0,
      hasFootprint: true,
    })
  })
})
