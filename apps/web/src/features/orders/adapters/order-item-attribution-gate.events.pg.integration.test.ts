// Server-side refusal proof for the item-attribution own-scope gate (brief 0075,
// #1267): a self-scoped member_operator cannot attribute an order item to a
// COLLEAGUE — neither when adding (`addItemToOrder`) nor when re-attributing
// (`updateItemAttribution`). `denyIfNotOwnOrder` protects a comanda by its
// EXISTING items, but a freshly-opened order (zero items) passes vacuously, so a
// member could otherwise inject a colleague-attributed item (a commission line in
// someone else's name). The gate locks the attribution TARGET itself: the balcão
// attributes to anyone; a self-scoped member only to themselves. The smart
// default (no `attributedUserId` → own uid) stays preserved.
//
// Seam: the full order actions run against REAL Postgres; only the session
// (`getSessionUser`) is mocked, so `requireOrgCtx` resolves the acting membership
// from the seeded `memberships` row exactly like production. The test asserts the
// refusal AND that the order projection never gains a colleague-attributed item.

import { computeOrderTotals, defaultPermissionsForRole, type Order, type Role } from '@/domain'
import { OrderConfig } from '@/domain/aggregates'
import { aggregateRef, appendEvent } from '@/domain/effect'
import { loadOrderById } from '@/features/orders/adapters/order-financial-read'
import { PostgresPersistenceLayer } from '@/shared/db/pg/effect/postgres-layer'
import { closeEventStoreDb, getEventStorePool } from '@/shared/db/pg/pool'
import { putUser } from '@/shared/db/pg/users-store'
import type { SessionUser } from '@/shared/firebase/admin'
import { buildUser } from '@/shared/fixtures/domain-builders'
import { Effect } from 'effect'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getSessionUser: vi.fn<() => Promise<SessionUser | null>>() }))
vi.mock('@/shared/firebase/admin', () => ({ getSessionUser: mocks.getSessionUser }))
// `revalidatePath` requires a Next request scope, absent in the integration
// runner — stub it; the order write under test is upstream of it.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { addItemToOrder, updateItemAttribution } from './orders.actions'

const TS = '2026-06-01T12:00:00.000Z'

let seq = 0
function uniqueOrg(): string {
  seq += 1
  return `attr-gate-${Date.now()}-${seq}`
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

// Seed a PRODUCT (no MemberOperation required to operate — retail; brief 0030
// AC-05). Read live inside `addItemToOrder`'s transactional guard.
async function seedProduct(orgId: string, productId: string, unitId: string): Promise<void> {
  await pool().query(
    `INSERT INTO catalog_items (org_id, id, last_event_version, kind, name, category_id, price_cents, price_visibility, active, archived_at, duration_minutes, sku, stock, gtin14, reconciliation_pending, reconciliation_last_attempt, commission, unit_ids, unit_overrides, required_resources, public_visible, created_at, updated_at)
     VALUES ($1,$2,1,'product','Product',NULL,3000,'visible',true,NULL,NULL,NULL,100,NULL,NULL,NULL,NULL,$3::jsonb,NULL,NULL,false,$4,$4)
     ON CONFLICT (org_id, id) DO NOTHING`,
    [orgId, productId, JSON.stringify([unitId]), TS],
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

// Opens an OPEN order through the real event-first path. `items` may carry an
// initial item (already attributed) to drive the re-attribution test.
async function seedOpenOrder(
  orgId: string,
  unitId: string,
  items: Order['items'],
): Promise<string> {
  const orderId = id('order')
  const totals = computeOrderTotals(items, 0)
  const order: Order = {
    id: orderId,
    orgId,
    unitId,
    customerId: null,
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

function addProductForm(args: { productId: string; attributedUserId?: string }) {
  const fd = new FormData()
  fd.set('kind', 'product')
  fd.set('refId', args.productId)
  fd.set('quantity', '1')
  if (args.attributedUserId !== undefined) fd.set('attributedUserId', args.attributedUserId)
  return fd
}

const TABLES =
  'events, projections, orders, commissions, member_operation_units, member_operation_services, member_operations, catalog_items, memberships, units, orgs, users'

describe('order item attribution own-scope gate (brief 0075, #1267)', () => {
  beforeEach(async () => {
    await pool().query(`TRUNCATE ${TABLES} CASCADE`)
    vi.clearAllMocks()
  })
  afterAll(async () => {
    await closeEventStoreDb()
  })

  const UNIT = 'unit-1'

  it('addItemToOrder — self-scoped member attributing to a COLLEAGUE → REFUSED, no item written', async () => {
    const orgId = uniqueOrg()
    await seedOrg(orgId)
    await seedUnit(orgId, UNIT)
    const actorUid = id('actor')
    const colleagueUid = id('colleague')
    await seedActingUser(orgId, actorUid)
    await seedMembership(orgId, actorUid, 'member_operator')
    await seedMembership(orgId, colleagueUid, 'member_operator')
    const productId = id('prod')
    await seedProduct(orgId, productId, UNIT)
    const orderId = await seedOpenOrder(orgId, UNIT, [])
    mocks.getSessionUser.mockResolvedValue({
      uid: actorUid,
      email: null,
      displayName: null,
      picture: null,
      emailVerified: true,
    })

    const result = await addItemToOrder(
      orderId,
      addProductForm({ productId, attributedUserId: colleagueUid }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('Você só pode atribuir itens a si mesmo')
    // The order gained no item — the colleague-attributed commission line never formed.
    const order = await loadOrderById(orgId, orderId)
    expect(order?.items).toHaveLength(0)
  })

  it('addItemToOrder — self-scoped member with NO attributedUserId → smart default to own uid (preserved)', async () => {
    const orgId = uniqueOrg()
    await seedOrg(orgId)
    await seedUnit(orgId, UNIT)
    const actorUid = id('actor')
    await seedActingUser(orgId, actorUid)
    await seedMembership(orgId, actorUid, 'member_operator')
    const productId = id('prod')
    await seedProduct(orgId, productId, UNIT)
    const orderId = await seedOpenOrder(orgId, UNIT, [])
    mocks.getSessionUser.mockResolvedValue({
      uid: actorUid,
      email: null,
      displayName: null,
      picture: null,
      emailVerified: true,
    })

    const result = await addItemToOrder(orderId, addProductForm({ productId }))

    expect(result.ok).toBe(true)
    const order = await loadOrderById(orgId, orderId)
    expect(order?.items).toHaveLength(1)
    expect(order?.items[0]?.attributedUserId).toBe(actorUid)
  })

  it('addItemToOrder — balcão (receptionist) attributing to anyone → ALLOWED', async () => {
    const orgId = uniqueOrg()
    await seedOrg(orgId)
    await seedUnit(orgId, UNIT)
    const actorUid = id('actor')
    const colleagueUid = id('colleague')
    await seedActingUser(orgId, actorUid)
    await seedMembership(orgId, actorUid, 'receptionist')
    await seedMembership(orgId, colleagueUid, 'member_operator')
    const productId = id('prod')
    await seedProduct(orgId, productId, UNIT)
    const orderId = await seedOpenOrder(orgId, UNIT, [])
    mocks.getSessionUser.mockResolvedValue({
      uid: actorUid,
      email: null,
      displayName: null,
      picture: null,
      emailVerified: true,
    })

    const result = await addItemToOrder(
      orderId,
      addProductForm({ productId, attributedUserId: colleagueUid }),
    )

    expect(result.ok).toBe(true)
    const order = await loadOrderById(orgId, orderId)
    expect(order?.items[0]?.attributedUserId).toBe(colleagueUid)
  })

  it('updateItemAttribution — self-scoped member re-attributing own item to a COLLEAGUE → REFUSED', async () => {
    const orgId = uniqueOrg()
    await seedOrg(orgId)
    await seedUnit(orgId, UNIT)
    const actorUid = id('actor')
    const colleagueUid = id('colleague')
    await seedActingUser(orgId, actorUid)
    await seedMembership(orgId, actorUid, 'member_operator')
    await seedMembership(orgId, colleagueUid, 'member_operator')
    const productId = id('prod')
    await seedProduct(orgId, productId, UNIT)
    // The order already holds one item attributed to the acting member, so
    // `denyIfNotOwnOrder` passes — isolating the attribution-target gate.
    const itemId = 'item-1'
    const orderId = await seedOpenOrder(orgId, UNIT, [
      {
        id: itemId,
        kind: 'product',
        refId: productId,
        name: 'Product',
        quantity: 1,
        unitPriceCents: 3000,
        commission: null,
        attributedUserId: actorUid,
      },
    ])
    mocks.getSessionUser.mockResolvedValue({
      uid: actorUid,
      email: null,
      displayName: null,
      picture: null,
      emailVerified: true,
    })

    const result = await updateItemAttribution(orderId, itemId, colleagueUid)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('Você só pode atribuir itens a si mesmo')
    // Attribution unchanged — still the acting member's.
    const order = await loadOrderById(orgId, orderId)
    expect(order?.items[0]?.attributedUserId).toBe(actorUid)
  })
})
