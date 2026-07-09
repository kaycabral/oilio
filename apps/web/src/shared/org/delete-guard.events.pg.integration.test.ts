import type { MembershipStatus, SubscriptionStatus } from '@/domain'
import { AppointmentConfig } from '@/domain/aggregates/appointment/config'
import { aggregateRef } from '@/domain/effect'
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
  canDeleteMemberOperation,
  canDeletePlan,
  canDeleteUnit,
  getCustomerDeletionImpact,
} from './delete-guard'

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
  await seedOrg(orgId)
  await seedUnit(orgId, 'unit')
  await seedCustomer(orgId, customerId)
  await insertRow('subscriptions', SUBSCRIPTION_COLUMNS, subscriptionColumnValues(sub, 1))
}

async function seedAppointment(
  orgId: string,
  opts: {
    status: 'scheduled' | 'completed' | 'cancelled'
    startAt: string
    unitId?: string
    memberOperationId?: string
    customerId?: string
  },
): Promise<void> {
  const id = uid('appt')
  const unitId = opts.unitId ?? 'unit'
  const memberOperationId = opts.memberOperationId ?? 'pro'
  const customerId = opts.customerId ?? 'cust'
  const appt = buildAppointment(id, orgId, TS, {
    status: opts.status,
    startAt: opts.startAt,
    endAt: opts.startAt,
    unitId,
    memberOperationId,
    customerId,
  })
  await seedOrg(orgId)
  await seedUnit(orgId, unitId)
  await seedMemberOperationRow(orgId, memberOperationId)
  await seedCustomer(orgId, customerId)
  await seedService(orgId, 'svc')
  await insertRow(
    'appointments',
    APPOINTMENT_COLUMNS,
    appointmentColumnValues(appt, aggregateRef(AppointmentConfig, orgId, id), 1),
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
  await seedOrg(orgId)
  await seedUnit(orgId, 'unit')
  await seedCustomer(orgId, customerId)
  await getEventStorePool().query(
    `INSERT INTO orders (org_id, id, unit_id, last_event_version, customer_id, appointment_id, status, closed_at, payment_method, discount_cents, subtotal_cents, total_cents, items, created_at, updated_at)
     VALUES ($1,$2,'unit',1,$3,NULL,$4,$5,$6,0,0,0,$7::jsonb,$8,$8)`,
    [orgId, id, customerId, opts.status, closedAt, paymentMethod, items, TS],
  )
}

async function seedOrg(orgId: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO orgs (org_id, id, last_event_version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1,$1,1,'Org X',$2,'other',$3,'{}'::jsonb,$4,$4)
     ON CONFLICT (org_id) DO NOTHING`,
    [orgId, `slug-${orgId}`, uid('owner'), TS],
  )
}

async function seedUnit(orgId: string, unitId: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO units (org_id, id, last_event_version, name, slug, timezone, agenda_mode, fiscal_kind, address, agenda, fiscal, created_at, updated_at)
     VALUES ($1,$2,1,'Unit','unit-'||$2,'America/Sao_Paulo','always_open','informal','{"postalCode":"01310100","state":"SP","city":"São Paulo","neighborhood":"Bela Vista","street":"Avenida Paulista","number":"1000","complement":null}'::jsonb,'{}'::jsonb,'{}'::jsonb,$3,$3)
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

async function seedService(orgId: string, serviceId: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO catalog_items (org_id, id, last_event_version, kind, name, category_id, price_cents, price_visibility, active, archived_at, duration_minutes, sku, stock, gtin14, reconciliation_pending, reconciliation_last_attempt, commission, unit_ids, unit_overrides, required_resources, public_visible, created_at, updated_at)
     VALUES ($1,$2,1,'service','Service',NULL,5000,'visible',true,NULL,30,NULL,NULL,NULL,NULL,NULL,NULL,'["unit-seed"]'::jsonb,NULL,NULL,false,$3,$3)
     ON CONFLICT (org_id, id) DO NOTHING`,
    [orgId, serviceId, TS],
  )
}

async function seedMemberOperationRow(orgId: string, memberOperationId: string): Promise<void> {
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

async function seedMemberOperation(
  orgId: string,
  opts: { userId?: string; unitIds?: string[] } = {},
): Promise<string> {
  await seedOrg(orgId)
  const id = uid('pro')
  const userId = opts.userId ?? uid('u')
  const unitIds = opts.unitIds ?? []
  await getEventStorePool().query(
    `INSERT INTO memberships (org_id, id, user_id, last_event_version, role, status, joined_at, permissions, updated_at)
     VALUES ($1,$1||'_'||$2,$2,1,'member_operator','active',$3,'{}'::jsonb,$3)
     ON CONFLICT (org_id, id) DO NOTHING`,
    [orgId, userId, TS],
  )
  await getEventStorePool().query(
    `INSERT INTO member_operations (org_id, id, last_event_version, user_id, member_id, default_commission, unit_ids, catalog_service_ids, created_at, updated_at)
     VALUES ($1,$2,1,$3,$1||'_'||$3,NULL,$4::jsonb,'[]'::jsonb,$5,$5)`,
    [orgId, id, userId, JSON.stringify(unitIds), TS],
  )
  for (const unitId of unitIds) {
    await getEventStorePool().query(
      `INSERT INTO units (org_id, id, last_event_version, name, slug, timezone, agenda_mode, fiscal_kind, address, agenda, fiscal, created_at, updated_at)
       VALUES ($1,$2,1,'Unit','unit-'||$2,'America/Sao_Paulo','always_open','informal','{"postalCode":"01310100","state":"SP","city":"São Paulo","neighborhood":"Bela Vista","street":"Avenida Paulista","number":"1000","complement":null}'::jsonb,'{}'::jsonb,'{}'::jsonb,$3,$3)
       ON CONFLICT (org_id, id) DO NOTHING`,
      [orgId, unitId, TS],
    )
    await getEventStorePool().query(
      `INSERT INTO member_operation_units (org_id, member_operation_id, unit_id) VALUES ($1,$2,$3)
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
    `INSERT INTO memberships (org_id, id, user_id, last_event_version, role, status, rls_unit_scope, invited_by, joined_at, permissions, updated_at)
     VALUES ($1,$2,$3,1,$4,$5,NULL,NULL,$6,$7::jsonb,$6)
     ON CONFLICT (org_id, id) DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status, permissions = EXCLUDED.permissions`,
    [orgId, m.id, userId, m.role, status, TS, JSON.stringify(m.permissions)],
  )
}

const TABLES =
  'subscriptions, appointments, orders, member_operations, memberships, units, customers, catalog_items, orgs'

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

  it('memberOperation scoped to the unit → blocked', async () => {
    const t = uniqueOrg()
    const unitId = uid('unit')
    await seedMemberOperation(t, { unitIds: [unitId] })
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

describe('canDeleteMemberOperation — future appointment / active membership vs historical', () => {
  beforeEach(async () => {
    await getEventStorePool().query(`TRUNCATE ${TABLES} CASCADE`)
  })
  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('no reference (revoked membership, no future appt) → deletable', async () => {
    const t = uniqueOrg()
    const u = uid('u')
    const proId = await seedMemberOperation(t, { userId: u })
    await seedMembership(t, u, 'revoked')
    expect(await canDeleteMemberOperation(t, proId)).toBe(true)
  })

  it('memberOperation doc absent → deletable (nothing to orphan)', async () => {
    const t = uniqueOrg()
    expect(await canDeleteMemberOperation(t, 'ghost')).toBe(true)
  })

  it('active membership → blocked', async () => {
    const t = uniqueOrg()
    const u = uid('u')
    const proId = await seedMemberOperation(t, { userId: u })
    await seedMembership(t, u, 'active')
    expect(await canDeleteMemberOperation(t, proId)).toBe(false)
  })

  it('suspended membership (0029 deactivation, reversible) → still blocked', async () => {
    const t = uniqueOrg()
    const u = uid('u')
    const proId = await seedMemberOperation(t, { userId: u })
    await seedMembership(t, u, 'suspended')
    expect(await canDeleteMemberOperation(t, proId)).toBe(false)
  })

  it('future scheduled appointment → blocked even after offboarding', async () => {
    const t = uniqueOrg()
    const u = uid('u')
    const proId = await seedMemberOperation(t, { userId: u })
    await seedMembership(t, u, 'revoked')
    await seedAppointment(t, { memberOperationId: proId, status: 'scheduled', startAt: future() })
    expect(await canDeleteMemberOperation(t, proId)).toBe(false)
  })

  it('only past/completed/cancelled appointments + revoked membership (historical) → deletable', async () => {
    const t = uniqueOrg()
    const u = uid('u')
    const proId = await seedMemberOperation(t, { userId: u })
    await seedMembership(t, u, 'revoked')
    await seedAppointment(t, { memberOperationId: proId, status: 'scheduled', startAt: past() })
    await seedAppointment(t, { memberOperationId: proId, status: 'completed', startAt: future() })
    await seedAppointment(t, { memberOperationId: proId, status: 'cancelled', startAt: future() })
    expect(await canDeleteMemberOperation(t, proId)).toBe(true)
  })
})

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
