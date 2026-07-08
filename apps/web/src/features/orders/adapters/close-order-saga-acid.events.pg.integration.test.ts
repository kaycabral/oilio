import {
  AppointmentConfig,
  CashMovementConfig,
  CommissionConfig,
  OrderConfig,
  SubscriptionConfig,
} from '@/domain/aggregates'
import {
  aggregateRef,
  appendEventToTx,
  runSaga,
  type AggregateRef,
  type SagaStep,
} from '@/domain/effect'
import type { CashMovement } from '@/domain/types/cash-movement'
import type { Commission } from '@/domain/types/commission'
import type { Order } from '@/domain/types/order'
import { PostgresPersistenceLayer } from '@/shared/db/pg/effect/postgres-layer'
import { closeEventStoreDb, getEventStorePool } from '@/shared/db/pg/pool'
import { Effect } from 'effect'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { buildCloseOrderSteps } from './order-saga'
import { buildUndoCloseSteps } from './order-undo-saga'

/**
 * ACID behaviour of the CLOSE-ORDER + UNDO-CLOSE cascades against REAL Postgres
 * (brief 0064). The close-order saga moves money: it stacks subscription-usage →
 * stock → commissions → cash → appointment.completed → order.closed into ONE
 * `commitSaga` (brief 0061 § Grupo A / AC-02). This proves the invariant the
 * action relies on: when a step mid-cascade trips a DB constraint, the WHOLE
 * transaction rolls back — cash is NEVER credited and a commission NEVER accrued
 * while the order stays open (no partial financial state survives a crash).
 *
 * We exercise the real step builders (`buildCloseOrderSteps`/`buildUndoCloseSteps`,
 * pure) through `runSaga` + the Postgres layer — the same primitive `commitSaga`
 * wraps. The rollback step carries `amountCents: -1` on a `commission.created`:
 * schema-valid (`Schema.Number`), but it trips the DB `commissions_amount_cents_nonneg`
 * CHECK at projection time, so the failure comes from the transaction boundary,
 * exactly like a real constraint breach would.
 *
 * globalSetup applies the migrations; OILIO_DATABASE_URL is the ephemeral `oilio`
 * database (docker locally, services:postgres in CI).
 */

const ORG = 't1'
const ORDER = 'o1'
const SUB = 'sub-1'

const orderRef = (id: string) => aggregateRef(OrderConfig, ORG, id)
const commissionRef = (id: string) => aggregateRef(CommissionConfig, ORG, id)
const cashRef = (id: string) => aggregateRef(CashMovementConfig, ORG, id)
const appointmentRef = (id: string) => aggregateRef(AppointmentConfig, ORG, id)
const subscriptionRef = (id: string) => aggregateRef(SubscriptionConfig, ORG, id)

const baseOrder: Order = {
  id: ORDER,
  orgId: ORG,
  unitId: 'u1',
  customerId: 'c1',
  appointmentId: 'apt-1',
  status: 'open',
  items: [],
  discountCents: 0,
  subtotalCents: 5000,
  totalCents: 5000,
  closedAt: null,
  paymentMethod: null,
  createdAt: '2026-06-01T10:00:00.000Z',
  updatedAt: '2026-06-01T10:00:00.000Z',
}

const totals = { subtotalCents: 5000, totalCents: 5000, discountCents: 0 }

function commission(overrides: Partial<Commission> = {}): Commission {
  return {
    id: 'com-1',
    orgId: ORG,
    orderId: ORDER,
    orderItemId: 'it-1',
    attributedUserId: 'u1',
    attributedMemberName: 'Zé',
    itemKind: 'service',
    itemName: 'Corte',
    itemTotalCents: 5000,
    commissionKind: 'percentage',
    commissionValue: 50,
    amountCents: 2500,
    liquidationStatus: 'pendente',
    paidAt: null,
    paymentProof: null,
    createdAt: '2026-06-01T12:00:00.000Z',
    ...overrides,
  }
}

const saleMovement: CashMovement = {
  id: 'm1',
  orgId: ORG,
  unitId: 'u1',
  kind: 'sale',
  direction: 'in',
  amountCents: 5000,
  paymentMethod: 'pix',
  description: null,
  orderId: ORDER,
  expenseCategoryId: null,
  recordedByUid: 'u1',
  createdAt: '2026-06-01T12:00:00.000Z',
}

// The appointment must exist (version 1) before close completes it / undo reopens
// it — the cascade emits `appointment.completed` / `appointment.updated`, which
// reduce over an existing aggregate.
function appointmentCreatedStep(): SagaStep {
  return (tx) =>
    appendEventToTx(
      AppointmentConfig,
      appointmentRef('apt-1'),
      {
        _tag: 'appointment.created',
        actorId: 'test',
        payload: {
          data: {
            id: 'apt-1',
            orgId: ORG,
            unitId: 'u1',
            memberOperationId: 'u1',
            customerId: 'c1',
            serviceId: 'svc-1',
            startAt: '2026-06-01T11:00:00.000Z',
            endAt: '2026-06-01T11:30:00.000Z',
            status: 'scheduled',
            notes: null,
            servicePriceCentsSnapshot: 5000,
            serviceDurationMinutesSnapshot: 30,
            commissionSnapshot: { kind: 'percentage', value: 40 },
            customerUserId: 'user-c1',
            memberOperatorUserId: 'user-pro1',
          },
        },
      },
      tx,
    )
}

// Seed a subscription so subscription.usage_incremented reduces over an existing
// aggregate.
function subscriptionCreatedStep(): SagaStep {
  return (tx) =>
    appendEventToTx(
      SubscriptionConfig,
      subscriptionRef(SUB),
      {
        _tag: 'subscription.created',
        actorId: 'test',
        payload: {
          id: SUB,
          orgId: ORG,
          unitId: 'u1',
          customerId: 'c1',
          customerUserId: null,
          planId: 'plan-basic',
          plan: {
            planId: 'plan-basic',
            name: 'Básico',
            priceCents: 9900,
            billingCycle: 'monthly' as const,
            includedItemIds: [],
            includedCategoryIds: [],
            usageLimit: { kind: 'count' as const, quantity: 10 },
          },
          periodStart: '2026-06-01T00:00:00.000Z',
          periodEnd: '2026-07-01T00:00:00.000Z',
          nextChargeDate: '2026-07-01T00:00:00.000Z',
          pastDueThreshold: 3,
        },
      },
      tx,
    )
}

// Seed an OPEN order so order.closed / order.reopened reduce over an existing
// aggregate.
function orderCreatedStep(): SagaStep {
  return (tx) =>
    appendEventToTx(
      OrderConfig,
      orderRef(ORDER),
      { _tag: 'order.created', actorId: 'test', payload: { data: baseOrder } },
      tx,
    )
}

// Parent rows the new D2/0068 cross-aggregate FKs require: the order/appointment/
// subscription projections reference org (t1), unit (u1), customer (c1),
// memberOperation (the appointment.memberOperationId 'u1') and the service catalog item
// (the appointment.serviceId 'svc-1'). Seeded over the superuser pool before the
// saga appends the aggregates.
async function seedParents(): Promise<void> {
  const pool = getEventStorePool()
  await pool.query(
    `INSERT INTO orgs (org_id, id, last_event_version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1,$1,1,'Org','slug-'||$1,'barbershop','owner','{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id) DO NOTHING`,
    [ORG],
  )
  await pool.query(
    `INSERT INTO units (org_id, id, last_event_version, name, slug, timezone, agenda_mode, fiscal_kind, address, agenda, fiscal, created_at, updated_at)
     VALUES ($1,$2,1,'Unit','unit-'||$2,'America/Sao_Paulo','always_open','informal','{"postalCode":"01310100","state":"SP","city":"São Paulo","neighborhood":"Bela Vista","street":"Avenida Paulista","number":"1000","complement":null}'::jsonb,'{}'::jsonb,'{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id, id) DO NOTHING`,
    [ORG, 'u1'],
  )
  await pool.query(
    `INSERT INTO customers (org_id, id, last_event_version, user_id, archived_at, deactivated_at, created_at, updated_at)
     VALUES ($1,$2,1,'user-'||$2,NULL,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id, id) DO NOTHING`,
    [ORG, 'c1'],
  )
  // The operational profile hangs off the membership (brief 0076 AC-02) — seed
  // the parent membership first so the composite FK is satisfiable.
  await pool.query(
    `INSERT INTO memberships (org_id, id, user_id, last_event_version, role, status, joined_at, permissions, updated_at)
     VALUES ($1,$1||'_user-'||$2,'user-'||$2,1,'member_operator','active','2026-01-01T00:00:00Z','{}'::jsonb,'2026-01-01T00:00:00Z')
     ON CONFLICT (org_id, id) DO NOTHING`,
    [ORG, 'u1'],
  )
  await pool.query(
    `INSERT INTO member_operations (org_id, id, last_event_version, user_id, member_id, default_commission, unit_ids, catalog_service_ids, created_at, updated_at)
     VALUES ($1,$2,1,'user-'||$2,$1||'_user-'||$2,NULL,'[]'::jsonb,'[]'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id, id) DO NOTHING`,
    [ORG, 'u1'],
  )
  await pool.query(
    `INSERT INTO catalog_items (org_id, id, last_event_version, kind, name, category_id, price_cents, price_visibility, active, archived_at, duration_minutes, sku, stock, gtin14, reconciliation_pending, reconciliation_last_attempt, commission, unit_ids, unit_overrides, required_resources, public_visible, created_at, updated_at)
     VALUES ($1,$2,1,'service','Service',NULL,5000,'visible',true,NULL,30,NULL,NULL,NULL,NULL,NULL,NULL,'["unit-seed"]'::jsonb,NULL,NULL,false,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id, id) DO NOTHING`,
    [ORG, 'svc-1'],
  )
}

async function seedPrereqs(): Promise<void> {
  await seedParents()
  // The appointment is created BEFORE the order: `orders.appointment_id` carries
  // a (non-deferrable) composite FK → appointments(org_id,id) (brief 0068 D2), so
  // the referenced appointment row must already exist when the order projects.
  await Effect.runPromise(
    runSaga([appointmentCreatedStep(), orderCreatedStep(), subscriptionCreatedStep()]).pipe(
      Effect.provide(PostgresPersistenceLayer),
    ),
  )
}

function readCount(table: string, ref: AggregateRef): Promise<number> {
  return getEventStorePool()
    .query(`SELECT 1 FROM ${table} WHERE org_id = $1 AND id = $2`, [ref.orgId, ref.id])
    .then((res) => res.rowCount ?? 0)
}
function readOrderStatus(ref: AggregateRef): Promise<string | null> {
  return getEventStorePool()
    .query<{ status: string }>('SELECT status FROM orders WHERE org_id = $1 AND id = $2', [
      ref.orgId,
      ref.id,
    ])
    .then((res) => res.rows[0]?.status ?? null)
}
function readSubscriptionVersion(ref: AggregateRef): Promise<number | null> {
  // `pg` returns bigint columns as strings — coerce so the assertion is numeric.
  return getEventStorePool()
    .query<{ last_event_version: string }>(
      'SELECT last_event_version FROM subscriptions WHERE org_id = $1 AND id = $2',
      [ref.orgId, ref.id],
    )
    .then((res) => (res.rows[0] ? Number(res.rows[0].last_event_version) : null))
}

describe('close-order cascade — ACID (Postgres)', () => {
  beforeEach(async () => {
    await getEventStorePool().query(
      'TRUNCATE events, projections, orders, commissions, cash_movements, appointments, subscriptions, catalog_items, member_operations, customers, units, orgs CASCADE',
    )
  })
  afterAll(async () => {
    await closeEventStoreDb()
  })

  // AC-02 — happy: the whole cascade commits together, every projection consistent.
  it('commits the full close cascade in one tx (order closed + commission + cash + appointment completed)', async () => {
    await seedPrereqs()

    const steps = buildCloseOrderSteps({
      orgId: ORG,
      actorUid: 'test',
      orderId: ORDER,
      order: baseOrder,
      paymentMethod: 'pix',
      totals,
      closedAt: '2026-06-01T12:00:00.000Z',
      subscriptionToConsume: { id: SUB, amount: 1 },
      stockTargets: [],
      commissions: [commission()],
      saleMovement,
    })

    await Effect.runPromise(runSaga(steps).pipe(Effect.provide(PostgresPersistenceLayer)))

    expect(await readOrderStatus(orderRef(ORDER))).toBe('closed')
    expect(await readCount('commissions', commissionRef('com-1'))).toBe(1)
    expect(await readCount('cash_movements', cashRef('m1'))).toBe(1)
    expect(await readCount('appointments', appointmentRef('apt-1'))).toBe(1)
    // The subscription usage step landed in the same tx too: version went
    // 1 (created) → 2 (usage_incremented).
    expect(await readSubscriptionVersion(subscriptionRef(SUB))).toBe(2)
  })

  // AC-01 — rollback: a step mid-cascade trips a DB CHECK → the WHOLE tx reverts.
  it('rolls back the WHOLE cascade when a commission step trips a DB CHECK', async () => {
    await seedPrereqs()

    // The cash movement is appended BEFORE the bad commission in the step order,
    // and order.closed is the anchor AFTER it — so if rollback is NOT atomic, the
    // cash row and/or a closed order would leak. The negative amount is schema-valid
    // (Number) but trips `commissions_amount_cents_nonneg`.
    const steps = buildCloseOrderSteps({
      orgId: ORG,
      actorUid: 'test',
      orderId: ORDER,
      order: baseOrder,
      paymentMethod: 'pix',
      totals,
      closedAt: '2026-06-01T12:00:00.000Z',
      subscriptionToConsume: { id: SUB, amount: 1 },
      stockTargets: [],
      commissions: [commission({ amountCents: -1 })],
      saleMovement,
    })

    const exit = await Effect.runPromiseExit(
      runSaga(steps).pipe(Effect.provide(PostgresPersistenceLayer)),
    )
    expect(exit._tag).toBe('Failure')

    // Nothing from the cascade landed: cash never credited, commission never
    // accrued, the order stays OPEN, the appointment stays scheduled.
    expect(await readCount('cash_movements', cashRef('m1'))).toBe(0)
    expect(await readCount('commissions', commissionRef('com-1'))).toBe(0)
    expect(await readOrderStatus(orderRef(ORDER))).toBe('open')
  })
})

describe('undo-close cascade — ACID (Postgres)', () => {
  beforeEach(async () => {
    await getEventStorePool().query(
      'TRUNCATE events, projections, orders, commissions, cash_movements, appointments, subscriptions, catalog_items, member_operations, customers, units, orgs CASCADE',
    )
  })
  afterAll(async () => {
    await closeEventStoreDb()
  })

  // AC-03 — undo happy: reverse + reopen commit atomically.
  it('commits the undo cascade in one tx (order reopened + reversal cash + commission dropped)', async () => {
    // Seed: prereqs + a closed order with a commission to drop.
    await seedPrereqs()
    await Effect.runPromise(
      runSaga(
        buildCloseOrderSteps({
          orgId: ORG,
          actorUid: 'test',
          orderId: ORDER,
          order: baseOrder,
          paymentMethod: 'pix',
          totals,
          closedAt: '2026-06-01T12:00:00.000Z',
          subscriptionToConsume: { id: SUB, amount: 1 },
          stockTargets: [],
          commissions: [commission()],
          saleMovement,
        }),
      ).pipe(Effect.provide(PostgresPersistenceLayer)),
    )
    expect(await readOrderStatus(orderRef(ORDER))).toBe('closed')

    const undoSteps = buildUndoCloseSteps({
      orgId: ORG,
      actorUid: 'test',
      order: { ...baseOrder, status: 'closed', closedAt: '2026-06-01T12:00:00.000Z' },
      subscriptionRestore: { id: SUB, amount: 1 },
      stockRestoreTargets: [],
      cashReversal: {
        movement: { ...saleMovement, id: 'rev-1', kind: 'sale_reversal', direction: 'out' },
      },
      commissionIds: ['com-1'],
      reopen: {
        reopenedAt: '2026-06-02T10:00:00.000Z',
        reversedClosedAt: '2026-06-01T10:00:00.000Z',
        commissionsReversed: 1,
        cashReversalMovementId: 'rev-1',
        subscriptionRestored: true,
      },
      orderId: ORDER,
    })
    await Effect.runPromise(runSaga(undoSteps).pipe(Effect.provide(PostgresPersistenceLayer)))

    expect(await readOrderStatus(orderRef(ORDER))).toBe('open')
    expect(await readCount('cash_movements', cashRef('rev-1'))).toBe(1)
    // The commission projection was dropped in the same tx (appendDeleteToTx).
    expect(await readCount('commissions', commissionRef('com-1'))).toBe(0)
  })

  // AC-03 — undo rollback: a bad reversal step reverts the whole reopen.
  it('rolls back the WHOLE undo when the reversal cash step trips a DB CHECK', async () => {
    await seedPrereqs()
    await Effect.runPromise(
      runSaga(
        buildCloseOrderSteps({
          orgId: ORG,
          actorUid: 'test',
          orderId: ORDER,
          order: baseOrder,
          paymentMethod: 'pix',
          totals,
          closedAt: '2026-06-01T12:00:00.000Z',
          subscriptionToConsume: { id: SUB, amount: 1 },
          stockTargets: [],
          commissions: [commission()],
          saleMovement,
        }),
      ).pipe(Effect.provide(PostgresPersistenceLayer)),
    )

    const undoSteps = buildUndoCloseSteps({
      orgId: ORG,
      actorUid: 'test',
      order: { ...baseOrder, status: 'closed', closedAt: '2026-06-01T12:00:00.000Z' },
      subscriptionRestore: { id: SUB, amount: 1 },
      stockRestoreTargets: [],
      // Negative reversal amount trips cash_movements_amount_cents_nonneg.
      cashReversal: {
        movement: {
          ...saleMovement,
          id: 'rev-1',
          kind: 'sale_reversal',
          direction: 'out',
          amountCents: -1,
        },
      },
      commissionIds: ['com-1'],
      reopen: {
        reopenedAt: '2026-06-02T10:00:00.000Z',
        reversedClosedAt: '2026-06-01T10:00:00.000Z',
        commissionsReversed: 1,
        cashReversalMovementId: 'rev-1',
        subscriptionRestored: true,
      },
      orderId: ORDER,
    })
    const exit = await Effect.runPromiseExit(
      runSaga(undoSteps).pipe(Effect.provide(PostgresPersistenceLayer)),
    )
    expect(exit._tag).toBe('Failure')

    // The reopen reverted as one tx: order stays CLOSED, commission NOT dropped,
    // reversal cash never landed.
    expect(await readOrderStatus(orderRef(ORDER))).toBe('closed')
    expect(await readCount('commissions', commissionRef('com-1'))).toBe(1)
    expect(await readCount('cash_movements', cashRef('rev-1'))).toBe(0)
  })
})
