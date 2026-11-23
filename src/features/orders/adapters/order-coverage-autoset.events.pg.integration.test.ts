import { computeOrderTotals, defaultPermissionsForRole, type Order, type Role } from '@/domain'
import { OrderConfig } from '@/domain/aggregates'
import { aggregateRef, appendEvent } from '@/domain/effect'
import { loadOrderById } from '@/features/orders/adapters/order-financial-read'
import type { SessionUser } from '@/shared/auth/session'
import { PostgresPersistenceLayer } from '@/shared/db/pg/effect/postgres-layer'
import { closeEventStoreDb, getEventStorePool } from '@/shared/db/pg/pool'
import { putUser } from '@/shared/db/pg/users-store'
import { buildUser } from '@/shared/fixtures/domain-builders'
import { Effect } from 'effect'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getSessionUser: vi.fn<() => Promise<SessionUser | null>>() }))
vi.mock('@/shared/auth/session', () => ({ getSessionUser: mocks.getSessionUser }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { addItemToOrder } from './orders.actions'

const TS = '2026-06-01T12:00:00.000Z'

let seq = 0
function uniqueOrg(): string {
  seq += 1
  return `cov-autoset-${Date.now()}-${seq}`
}
function id(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now()}-${seq}`
}

function pool() {
  return getEventStorePool()
}

async function seedOrg(orgId: string): Promise<void> {
  await pool().query(
    `INSERT INTO orgs (org_id, id, last_event_version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1,$1,1,'Org','slug-'||$1,'barbershop','owner','{}'::jsonb,$2,$2)
     ON CONFLICT (org_id) DO NOTHING`,
    [orgId, TS],
  )
}

async function seedUnit(orgId: string, unitId: string): Promise<void> {
  await pool().query(
    `INSERT INTO units (org_id, id, last_event_version, name, slug, timezone, agenda_mode, fiscal_kind, address, agenda, fiscal, archived_at, created_at, updated_at)
     VALUES ($1,$2,1,'Unit','unit-'||$2,'America/Sao_Paulo','always_open','informal','{"postalCode":"01310100","state":"SP","city":"São Paulo","neighborhood":"Bela Vista","street":"Avenida Paulista","number":"1000","complement":null}'::jsonb,'{}'::jsonb,'{}'::jsonb,NULL,$3,$3)
     ON CONFLICT (org_id, id) DO NOTHING`,
    [orgId, unitId, TS],
  )
}

async function seedProduct(
  orgId: string,
  productId: string,
  unitId: string,
  categoryId: string | null,
): Promise<void> {
  await pool().query(
    `INSERT INTO catalog_items (org_id, id, last_event_version, kind, name, category_id, price_cents, price_visibility, active, archived_at, duration_minutes, sku, stock, gtin14, reconciliation_pending, reconciliation_last_attempt, commission, unit_ids, unit_overrides, required_resources, public_visible, created_at, updated_at)
     VALUES ($1,$2,1,'product','Product',$5,3000,'visible',true,NULL,NULL,NULL,100,NULL,NULL,NULL,NULL,$3::jsonb,NULL,NULL,false,$4,$4)
     ON CONFLICT (org_id, id) DO NOTHING`,
    [orgId, productId, JSON.stringify([unitId]), TS, categoryId],
  )
}

async function seedCategory(orgId: string, categoryId: string): Promise<void> {
  await pool().query(
    `INSERT INTO categories (org_id, id, last_event_version, name, icon, color, active, archived_at, created_at, updated_at)
     VALUES ($1,$2,1,'Cat',NULL,NULL,true,NULL,$3,$3)
     ON CONFLICT (org_id, id) DO NOTHING`,
    [orgId, categoryId, TS],
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

async function seedActingUser(orgId: string, userId: string): Promise<void> {
  await putUser(buildUser(userId, TS, { currentOrgId: orgId, completionCompleted: true }))
}

async function seedCustomer(orgId: string, customerId: string, userId: string): Promise<void> {
  await pool().query(
    `INSERT INTO customers (org_id, id, last_event_version, user_id, archived_at, deactivated_at, created_at, updated_at)
     VALUES ($1,$2,1,$3,NULL,NULL,$4,$4)`,
    [orgId, customerId, userId, TS],
  )
}

async function seedSubscription(args: {
  orgId: string
  customerId: string
  unitId: string
  includedItemIds: string[]
  includedCategoryIds: string[]
  usageLimit: { kind: 'unlimited' } | { kind: 'count'; quantity: number }
  consumed: number
}): Promise<void> {
  const { orgId, customerId, unitId, consumed } = args
  const snapshot = {
    planId: 'p1',
    name: 'Plan',
    priceCents: 10000,
    billingCycle: 'monthly',
    includedItemIds: args.includedItemIds,
    includedCategoryIds: args.includedCategoryIds,
    usageLimit: args.usageLimit,
  }
  const currentPeriod = { startAt: TS, endAt: '2099-01-01T00:00:00.000Z', consumed }
  await pool().query(
    `INSERT INTO subscriptions (org_id, id, unit_id, last_event_version, customer_id, customer_user_id, status, billing_cycle, cancel_at_period_end, next_charge_date, past_due_cycles, past_due_threshold, cancellation_reason, cancelled_at, plan, current_period, created_at, updated_at)
     VALUES ($1,$2,$3,1,$4,NULL,'active','monthly',false,NULL,0,2,NULL,NULL,$5::jsonb,$6::jsonb,$7,$7)`,
    [
      orgId,
      id('sub'),
      unitId,
      customerId,
      JSON.stringify(snapshot),
      JSON.stringify(currentPeriod),
      TS,
    ],
  )
}

async function seedOpenOrder(
  orgId: string,
  unitId: string,
  customerId: string | null,
  items: Order['items'],
): Promise<string> {
  const orderId = id('order')
  const totals = computeOrderTotals(items, 0)
  const order: Order = {
    id: orderId,
    orgId,
    unitId,
    customerId,
    appointmentId: null,
    status: 'open',
    items,
    discountCents: 0,
    closedAt: null,
    paymentMethod: null,
    subtotalCents: totals.subtotalCents,
    totalCents: totals.totalCents,
    createdAt: TS,
    updatedAt: TS,
  }
  await Effect.runPromise(
    appendEvent(OrderConfig, aggregateRef(OrderConfig, orgId, orderId), {
      _tag: 'order.created',
      actorId: 'test',
      payload: { data: order },
    }).pipe(Effect.provide(PostgresPersistenceLayer)),
  )
  return orderId
}

function addProductForm(productId: string) {
  const fd = new FormData()
  fd.set('kind', 'product')
  fd.set('refId', productId)
  fd.set('quantity', '1')
  return fd
}

function mockSession(uid: string): void {
  mocks.getSessionUser.mockResolvedValue({
    uid,
    authUserId: uid,
    email: null,
    displayName: null,
    picture: null,
    emailVerified: true,
  })
}

const TABLES =
  'events, projections, orders, subscriptions, customers, commissions, member_operation_units, member_operation_services, member_operations, catalog_items, memberships, units, orgs, users'

describe('order item coverage auto-set on add (brief 0079, #1306)', () => {
  beforeEach(async () => {
    await pool().query(`TRUNCATE ${TABLES} CASCADE`)
    vi.clearAllMocks()
  })
  afterAll(async () => {
    await closeEventStoreDb()
  })

  const UNIT = 'unit-1'

  async function baseSetup(): Promise<{ orgId: string; actorUid: string; customerId: string }> {
    const orgId = uniqueOrg()
    await seedOrg(orgId)
    await seedUnit(orgId, UNIT)
    const actorUid = id('actor')
    await seedActingUser(orgId, actorUid)
    await seedMembership(orgId, actorUid, 'receptionist')
    const customerId = id('cust')
    await seedCustomer(orgId, customerId, id('cust-user'))
    mockSession(actorUid)
    return { orgId, actorUid, customerId }
  }

  it('covered item + balance → enters as subscription, R$ 0,00 in total', async () => {
    const { orgId, customerId } = await baseSetup()
    const productId = id('prod')
    await seedProduct(orgId, productId, UNIT, null)
    await seedSubscription({
      orgId,
      customerId,
      unitId: UNIT,
      includedItemIds: [productId],
      includedCategoryIds: [],
      usageLimit: { kind: 'count', quantity: 4 },
      consumed: 1,
    })
    const orderId = await seedOpenOrder(orgId, UNIT, customerId, [])

    const result = await addItemToOrder(orderId, addProductForm(productId))

    expect(result.ok).toBe(true)
    const order = await loadOrderById(orgId, orderId)
    expect(order?.items[0]?.coverage).toBe('subscription')
    expect(order?.items[0]?.subscriptionId).toBeTruthy()
    expect(order?.totalCents).toBe(0)
  })

  it('covered item WITHOUT balance → stays sale (AC-07)', async () => {
    const { orgId, customerId } = await baseSetup()
    const productId = id('prod')
    await seedProduct(orgId, productId, UNIT, null)
    await seedSubscription({
      orgId,
      customerId,
      unitId: UNIT,
      includedItemIds: [productId],
      includedCategoryIds: [],
      usageLimit: { kind: 'count', quantity: 4 },
      consumed: 4,
    })
    const orderId = await seedOpenOrder(orgId, UNIT, customerId, [])

    const result = await addItemToOrder(orderId, addProductForm(productId))

    expect(result.ok).toBe(true)
    const order = await loadOrderById(orgId, orderId)
    expect(order?.items[0]?.coverage ?? 'sale').toBe('sale')
    expect(order?.totalCents).toBe(3000)
  })

  it('item NOT covered by the plan → stays sale', async () => {
    const { orgId, customerId } = await baseSetup()
    const productId = id('prod')
    await seedProduct(orgId, productId, UNIT, null)
    await seedSubscription({
      orgId,
      customerId,
      unitId: UNIT,
      includedItemIds: ['other-item'],
      includedCategoryIds: [],
      usageLimit: { kind: 'unlimited' },
      consumed: 0,
    })
    const orderId = await seedOpenOrder(orgId, UNIT, customerId, [])

    const result = await addItemToOrder(orderId, addProductForm(productId))

    expect(result.ok).toBe(true)
    const order = await loadOrderById(orgId, orderId)
    expect(order?.items[0]?.coverage ?? 'sale').toBe('sale')
    expect(order?.totalCents).toBe(3000)
  })

  it('comanda with no customer (avulso) → stays sale', async () => {
    const orgId = uniqueOrg()
    await seedOrg(orgId)
    await seedUnit(orgId, UNIT)
    const actorUid = id('actor')
    await seedActingUser(orgId, actorUid)
    await seedMembership(orgId, actorUid, 'receptionist')
    mockSession(actorUid)
    const productId = id('prod')
    await seedProduct(orgId, productId, UNIT, null)
    const orderId = await seedOpenOrder(orgId, UNIT, null, [])

    const result = await addItemToOrder(orderId, addProductForm(productId))

    expect(result.ok).toBe(true)
    const order = await loadOrderById(orgId, orderId)
    expect(order?.items[0]?.coverage ?? 'sale').toBe('sale')
    expect(order?.totalCents).toBe(3000)
  })

  it('covered via category convenience + balance → subscription (kind-agnostic, AC-09)', async () => {
    const { orgId, customerId } = await baseSetup()
    const categoryId = id('cat')
    await seedCategory(orgId, categoryId)
    const productId = id('prod')
    await seedProduct(orgId, productId, UNIT, categoryId)
    await seedSubscription({
      orgId,
      customerId,
      unitId: UNIT,
      includedItemIds: [],
      includedCategoryIds: [categoryId],
      usageLimit: { kind: 'unlimited' },
      consumed: 0,
    })
    const orderId = await seedOpenOrder(orgId, UNIT, customerId, [])

    const result = await addItemToOrder(orderId, addProductForm(productId))

    expect(result.ok).toBe(true)
    const order = await loadOrderById(orgId, orderId)
    expect(order?.items[0]?.coverage).toBe('subscription')
    expect(order?.totalCents).toBe(0)
  })

  it('second covered add when balance is down to 1 → first subscription, second sale', async () => {
    const { orgId, customerId } = await baseSetup()
    const productId = id('prod')
    await seedProduct(orgId, productId, UNIT, null)
    await seedSubscription({
      orgId,
      customerId,
      unitId: UNIT,
      includedItemIds: [productId],
      includedCategoryIds: [],
      usageLimit: { kind: 'count', quantity: 4 },
      consumed: 3,
    })
    const orderId = await seedOpenOrder(orgId, UNIT, customerId, [])

    const first = await addItemToOrder(orderId, addProductForm(productId))
    expect(first.ok).toBe(true)
    const second = await addItemToOrder(orderId, addProductForm(productId))
    expect(second.ok).toBe(true)

    const order = await loadOrderById(orgId, orderId)
    const coverages = order?.items.map((it) => it.coverage ?? 'sale')
    expect(coverages).toEqual(['subscription', 'sale'])
    expect(order?.totalCents).toBe(3000)
  })
})
