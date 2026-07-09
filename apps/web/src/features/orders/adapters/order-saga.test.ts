import {
  AppointmentConfig,
  CashMovementConfig,
  CommissionConfig,
  OrderConfig,
} from '@/domain/aggregates'
import type { FirestoreDoc, SagaStep, TransactionContext } from '@/domain/effect'
import { aggregateRef } from '@/domain/effect'
import { docKey } from '@/domain/effect/test-layers'
import type { CashMovement } from '@/domain/types/cash-movement'
import type { Commission } from '@/domain/types/commission'
import type { Order } from '@/domain/types/order'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { buildCloseOrderSteps } from './order-saga'
import { buildUndoCloseSteps } from './order-undo-saga'

async function runSteps(steps: SagaStep[]): Promise<Map<string, FirestoreDoc>> {
  const store = new Map<string, FirestoreDoc>()
  const tx: TransactionContext = {
    getDoc: (ref) => Effect.succeed(store.get(docKey(ref)) ?? null),
    setDoc: (ref, data) =>
      Effect.sync(() => {
        const key = docKey(ref)
        store.set(key, { ...store.get(key), ...data })
      }),
    deleteDoc: (ref) =>
      Effect.sync(() => {
        store.delete(docKey(ref))
      }),
  }
  for (const step of steps) await Effect.runPromise(step(tx))
  return store
}

const baseOrder: Order = {
  id: 'o1',
  orgId: 't1',
  unitId: 'u1',
  customerId: 'c1',
  appointmentId: null,
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

const commission: Commission = {
  id: 'com-1',
  orgId: 't1',
  orderId: 'o1',
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
  createdAt: '2026-06-01T12:00:00.000Z',
}

const saleMovement: CashMovement = {
  id: 'm1',
  orgId: 't1',
  unitId: 'u1',
  kind: 'sale',
  direction: 'in',
  amountCents: 5000,
  paymentMethod: 'pix',
  description: null,
  orderId: 'o1',
  expenseCategoryId: null,
  recordedByUid: 'u1',
  createdAt: '2026-06-01T12:00:00.000Z',
}

describe('buildCloseOrderSteps', () => {
  it('a bare close (no consume/stock/commission/cash) is just order.closed', () => {
    const steps = buildCloseOrderSteps({
      orgId: 't1',
      actorUid: 'actor',
      orderId: 'o1',
      order: baseOrder,
      paymentMethod: null,
      totals,
      closedAt: '2026-06-01T12:00:00.000Z',
      subscriptionToConsume: null,
      stockTargets: [],
      commissions: [],
      saleMovement: null,
    })
    expect(steps).toHaveLength(1)
  })

  it('a full close stacks every cascade aggregate before the anchor', () => {
    const steps = buildCloseOrderSteps({
      orgId: 't1',
      actorUid: 'actor',
      orderId: 'o1',
      order: { ...baseOrder, appointmentId: 'apt-1' },
      paymentMethod: 'pix',
      totals,
      closedAt: '2026-06-01T12:00:00.000Z',
      subscriptionToConsume: { id: 'sub-1', amount: 1 },
      stockTargets: [{ refId: 'prod-1', nextStock: 9 }],
      commissions: [commission],
      saleMovement,
    })
    expect(steps).toHaveLength(6)
  })

  it('the built steps execute and write every aggregate of the cascade', async () => {
    const steps = buildCloseOrderSteps({
      orgId: 't1',
      actorUid: 'actor',
      orderId: 'o1',
      order: { ...baseOrder, appointmentId: 'apt-1' },
      paymentMethod: 'pix',
      totals,
      closedAt: '2026-06-01T12:00:00.000Z',
      subscriptionToConsume: { id: 'sub-1', amount: 1 },
      stockTargets: [{ refId: 'prod-1', nextStock: 9 }],
      commissions: [commission],
      saleMovement,
    })
    const store = await runSteps(steps)
    expect(store.get(docKey(aggregateRef(OrderConfig, 't1', 'o1')))).toMatchObject({
      status: 'closed',
    })
    expect(store.get(docKey(aggregateRef(CommissionConfig, 't1', 'com-1')))).toBeDefined()
    expect(store.get(docKey(aggregateRef(CashMovementConfig, 't1', 'm1')))).toBeDefined()
    expect(store.get(docKey(aggregateRef(AppointmentConfig, 't1', 'apt-1')))).toBeDefined()
  })
})

describe('buildUndoCloseSteps', () => {
  it('a bare undo (no restores) is just order.reopened', () => {
    const steps = buildUndoCloseSteps({
      orgId: 't1',
      actorUid: 'actor',
      order: baseOrder,
      subscriptionRestore: null,
      stockRestoreTargets: [],
      cashReversal: null,
      commissionIds: [],
      reopen: {
        reopenedAt: '2026-06-02T00:00:00Z',
        reversedClosedAt: '2026-06-01T00:00:00Z',
        reversedRevenueCents: 5000,
        unitId: 'unit-a',
        commissionsReversed: 0,
        cashReversalMovementId: null,
        subscriptionRestored: false,
      },
      orderId: 'o1',
    })
    expect(steps).toHaveLength(1)
  })

  it('a full undo reverses every aggregate + reopens', () => {
    const steps = buildUndoCloseSteps({
      orgId: 't1',
      actorUid: 'actor',
      order: { ...baseOrder, appointmentId: 'apt-1' },
      subscriptionRestore: { id: 'sub-1', amount: 1 },
      stockRestoreTargets: [{ refId: 'prod-1', nextStock: 10 }],
      cashReversal: {
        movement: { ...saleMovement, id: 'rev-1', kind: 'sale_reversal', direction: 'out' },
      },
      commissionIds: ['com-1', 'com-2'],
      reopen: {
        reopenedAt: '2026-06-02T00:00:00Z',
        reversedClosedAt: '2026-06-01T00:00:00Z',
        reversedRevenueCents: 5000,
        unitId: 'unit-a',
        commissionsReversed: 2,
        cashReversalMovementId: 'rev-1',
        subscriptionRestored: true,
      },
      orderId: 'o1',
    })
    expect(steps).toHaveLength(7)
  })

  it('the built undo steps execute and reverse + reopen', async () => {
    const seeded = await runSteps(
      buildUndoCloseSteps({
        orgId: 't1',
        actorUid: 'actor',
        order: {
          ...baseOrder,
          status: 'closed',
          closedAt: '2026-06-01T12:00:00.000Z',
          paymentMethod: 'pix',
          appointmentId: 'apt-1',
        },
        subscriptionRestore: { id: 'sub-1', amount: 1 },
        stockRestoreTargets: [{ refId: 'prod-1', nextStock: 10 }],
        cashReversal: {
          movement: { ...saleMovement, id: 'rev-1', kind: 'sale_reversal', direction: 'out' },
        },
        commissionIds: ['com-1'],
        reopen: {
          reopenedAt: '2026-06-02T00:00:00Z',
          reversedClosedAt: '2026-06-01T00:00:00Z',
          reversedRevenueCents: 5000,
          unitId: 'unit-a',
          commissionsReversed: 1,
          cashReversalMovementId: 'rev-1',
          subscriptionRestored: true,
        },
        orderId: 'o1',
      }),
    )
    expect(seeded.get(docKey(aggregateRef(OrderConfig, 't1', 'o1')))).toMatchObject({
      status: 'open',
    })
    expect(seeded.get(docKey(aggregateRef(CashMovementConfig, 't1', 'rev-1')))).toBeDefined()
  })
})
