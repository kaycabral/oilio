import {
  CashMovementConfig,
  CommissionConfig,
  OrderConfig,
  SubscriptionPlanConfig,
} from '@/domain/aggregates'
import { docKey } from '@/domain/effect/test-layers'
import { Effect, Layer, Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { aggregateRef, type AggregateRef } from './aggregate-ref'
import {
  appendDeleteToTx,
  appendEventGuardedToTx,
  appendEventToTx,
  EventValidationError,
  runSaga,
  type GuardReader,
  type SagaStep,
} from './event-store'
import type { FirestoreDoc, TransactionContext } from './services'
import { PersistencePort } from './services'

/**
 * Unit tests for the cross-aggregate saga primitives (brief 0061 § Grupo A —
 * `runSaga`/`appendEventToTx`/`appendDeleteToTx`). An in-memory `PersistencePort`
 * (mirroring the replay tests) models the event store WITHOUT a database: its
 * `runTransaction` runs the whole step list against a buffered store and only
 * commits (flushes) on success — so a step that fails rolls back EVERY aggregate
 * the saga touched, the ACID invariant the Postgres layer enforces for real.
 */

// A transactional store that buffers writes/deletes and only applies them on a
// clean commit. A throw inside `fn` discards the buffer — modeling ROLLBACK.
// Keyed by the typed ref (D6) via `docKey`; the event log is a sibling map.
function makeTxStore() {
  const store = new Map<string, FirestoreDoc>()
  const events = new Map<string, FirestoreDoc[]>()
  const layer = Layer.succeed(PersistencePort, {
    getDoc: (ref: AggregateRef) => Effect.succeed(store.get(docKey(ref)) ?? null),
    getDocs: () => Effect.succeed([]),
    getEvents: (ref: AggregateRef) => Effect.succeed([...(events.get(docKey(ref)) ?? [])]),
    setDoc: (ref: AggregateRef, data: FirestoreDoc) =>
      Effect.sync(() => {
        const key = docKey(ref)
        store.set(key, { ...store.get(key), ...data })
      }),
    runTransaction: <A, E>(fn: (tx: TransactionContext) => Effect.Effect<A, E, never>) => {
      const buffer = new Map(store)
      const eventBuffer = new Map([...events].map(([k, v]) => [k, [...v]]))
      const deletes = new Set<string>()
      const tx: TransactionContext = {
        getDoc: (ref) => Effect.succeed(buffer.get(docKey(ref)) ?? null),
        setDoc: (ref, data) =>
          Effect.sync(() => {
            const key = docKey(ref)
            deletes.delete(key)
            buffer.set(key, { ...buffer.get(key), ...data })
          }),
        appendEvent: (ref, _version, envelope) =>
          Effect.sync(() => {
            const key = docKey(ref)
            const log = eventBuffer.get(key) ?? []
            log.push(envelope)
            eventBuffer.set(key, log)
          }),
        deleteDoc: (ref) =>
          Effect.sync(() => {
            const key = docKey(ref)
            buffer.delete(key)
            deletes.add(key)
          }),
      }
      return fn(tx).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            // Commit: flush the buffers into the live store + event log.
            store.clear()
            for (const [k, v] of buffer) store.set(k, v)
            for (const key of deletes) store.delete(key)
            events.clear()
            for (const [k, v] of eventBuffer) events.set(k, v)
          }),
        ),
      )
    },
  })
  return { store, events, layer }
}

const orderRef = aggregateRef(OrderConfig, 't1', 'o1')
const commissionRef = aggregateRef(CommissionConfig, 't1', 'c1')
const cashRef = aggregateRef(CashMovementConfig, 't1', 'm1')

const commission = {
  id: 'c1',
  orgId: 't1',
  orderId: 'o1',
  orderItemId: 'it1',
  attributedUserId: 'u1',
  attributedMemberName: 'Zé',
  itemKind: 'service' as const,
  itemName: 'Corte',
  itemTotalCents: 5000,
  commissionKind: 'percentage' as const,
  commissionValue: 50,
  amountCents: 2500,
  liquidationStatus: 'pendente' as const,
  createdAt: '2026-06-01T12:00:00.000Z',
}

const saleMovement = {
  id: 'm1',
  orgId: 't1',
  unitId: 'unit-1',
  kind: 'sale' as const,
  direction: 'in' as const,
  amountCents: 5000,
  paymentMethod: 'pix' as const,
  description: null,
  orderId: 'o1',
  expenseCategoryId: null,
  recordedByUid: 'u1',
  createdAt: '2026-06-01T12:00:00.000Z',
}

describe('runSaga — cross-aggregate cascade as one transaction', () => {
  it('commits ALL aggregates of the cascade together', async () => {
    const { store, events, layer } = makeTxStore()
    const steps: SagaStep[] = [
      (tx) =>
        appendEventToTx(
          CommissionConfig,
          commissionRef,
          {
            _tag: 'commission.created',
            actorId: 'actor',
            payload: { data: commission },
          },
          tx,
        ),
      (tx) =>
        appendEventToTx(
          CashMovementConfig,
          cashRef,
          {
            _tag: 'cash_movement.created',
            actorId: 'actor',
            payload: { data: saleMovement },
          },
          tx,
        ),
    ]
    await Effect.runPromise(runSaga(steps).pipe(Effect.provide(layer)))

    // Both projections + their first event landed.
    expect(store.get(docKey(commissionRef))).toMatchObject({ id: 'c1', _version: 1 })
    expect(store.get(docKey(cashRef))).toMatchObject({ id: 'm1', _version: 1 })
    expect(events.get(docKey(commissionRef))?.[0]).toBeDefined()
    expect(events.get(docKey(cashRef))?.[0]).toBeDefined()
  })

  it('rolls back the WHOLE cascade when a later step fails (no partial state)', async () => {
    const { store, layer } = makeTxStore()
    const steps: SagaStep[] = [
      (tx) =>
        appendEventToTx(
          CommissionConfig,
          commissionRef,
          {
            _tag: 'commission.created',
            actorId: 'actor',
            payload: { data: commission },
          },
          tx,
        ),
      // Invalid event — schema reject aborts the tx.
      (tx) =>
        appendEventToTx(
          CashMovementConfig,
          cashRef,
          {
            _tag: 'cash_movement.created',
            actorId: 'actor',
            payload: { data: { ...saleMovement, kind: 'not_a_kind' } },
          },
          tx,
        ),
    ]
    const exit = await Effect.runPromiseExit(runSaga(steps).pipe(Effect.provide(layer)))
    expect(exit._tag).toBe('Failure')

    // Step 1 committed NOTHING — the failed step rolled back the commission too.
    expect(store.get(docKey(commissionRef))).toBeUndefined()
    expect(store.get(docKey(cashRef))).toBeUndefined()
  })

  it('a failing step fails with EventValidationError', async () => {
    const { layer } = makeTxStore()
    const steps: SagaStep[] = [
      (tx) =>
        appendEventToTx(
          OrderConfig,
          orderRef,
          {
            _tag: 'order.closed',
            actorId: 'actor',
            payload: { closedAt: 'x', subtotalCents: 'bad', totalCents: 0, paymentMethod: null },
          },
          tx,
        ),
    ]
    const exit = await Effect.runPromiseExit(runSaga(steps).pipe(Effect.provide(layer)))
    expect(exit._tag).toBe('Failure')
    if (exit._tag === 'Failure') {
      const err = exit.cause
      // The typed failure is an EventValidationError.
      expect(JSON.stringify(err)).toContain(
        new EventValidationError({ aggregateType: 'order', message: '' }).aggregateType,
      )
    }
  })
})

describe('appendDeleteToTx — event + projection drop in one tx', () => {
  it('appends the .deleted event and removes the projection row', async () => {
    const { store, events, layer } = makeTxStore()
    // Seed a commission projection.
    await Effect.runPromise(
      runSaga([
        (tx) =>
          appendEventToTx(
            CommissionConfig,
            commissionRef,
            {
              _tag: 'commission.created',
              actorId: 'actor',
              payload: { data: commission },
            },
            tx,
          ),
      ]).pipe(Effect.provide(layer)),
    )
    expect(store.get(docKey(commissionRef))).toBeDefined()

    // Delete it in a saga step.
    await Effect.runPromise(
      runSaga([
        (tx) =>
          appendDeleteToTx(
            CommissionConfig,
            commissionRef,
            {
              _tag: 'commission.deleted',
              actorId: 'actor',
              payload: {},
            },
            tx,
          ),
      ]).pipe(Effect.provide(layer)),
    )

    // The projection row is gone; the .deleted event is kept (history).
    expect(store.get(docKey(commissionRef))).toBeUndefined()
    expect(events.get(docKey(commissionRef))?.[1]).toBeDefined()
  })

  it('tolerates a tx WITHOUT deleteDoc — appends the event, skips the row drop', async () => {
    // A bare TransactionContext (getDoc/setDoc/appendEvent only, no deleteDoc) —
    // the shape the replay-test harnesses build. `appendDeleteToTx` must still
    // append the event and simply not attempt the (absent) row delete.
    const buffer = new Map<string, FirestoreDoc>()
    const eventLog = new Map<string, FirestoreDoc[]>()
    const bareTx: TransactionContext = {
      getDoc: (ref) => Effect.succeed(buffer.get(docKey(ref)) ?? null),
      setDoc: (ref, data) =>
        Effect.sync(() => {
          const key = docKey(ref)
          buffer.set(key, { ...buffer.get(key), ...data })
        }),
      appendEvent: (ref, _version, envelope) =>
        Effect.sync(() => {
          const key = docKey(ref)
          const log = eventLog.get(key) ?? []
          log.push(envelope)
          eventLog.set(key, log)
        }),
      // deleteDoc intentionally omitted (it's optional on TransactionContext).
    }
    await Effect.runPromise(
      appendDeleteToTx(
        CommissionConfig,
        commissionRef,
        {
          _tag: 'commission.deleted',
          actorId: 'actor',
          payload: {},
        },
        bareTx,
      ),
    )
    // The .deleted event was appended even without a deleteDoc.
    expect(eventLog.get(docKey(commissionRef))?.[0]).toBeDefined()
  })
})

describe('appendEventGuardedToTx — guard outcomes inside a shared tx', () => {
  // A bare in-memory tx (getDoc/setDoc/appendEvent) carrying a seeded
  // subscription plan the guard reads. The guard resolves a commission payload
  // (any aggregate works — we only exercise the guarded-append control flow, not
  // the domain).
  function bareTx(seed: Record<string, FirestoreDoc> = {}): {
    tx: TransactionContext
    store: Map<string, FirestoreDoc>
  } {
    const store = new Map<string, FirestoreDoc>(Object.entries(seed))
    const tx: TransactionContext = {
      getDoc: (ref) => Effect.succeed(store.get(docKey(ref)) ?? null),
      setDoc: (ref, data) =>
        Effect.sync(() => {
          const key = docKey(ref)
          store.set(key, { ...store.get(key), ...data })
        }),
      appendEvent: () => Effect.void,
    }
    return { tx, store }
  }

  const planRef = aggregateRef(SubscriptionPlanConfig, 't1', 'plan-1')
  const validCommissionPayload = {
    data: {
      id: 'c1',
      orgId: 't1',
      orderId: 'o1',
      orderItemId: 'it1',
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
    },
  }

  it('ok: appends the event + projection when the guard resolves', async () => {
    const { tx, store } = bareTx({ [docKey(planRef)]: { id: 'plan-1', active: true } })
    const outcome = await Effect.runPromise(
      appendEventGuardedToTx(
        {
          config: CommissionConfig,
          ref: commissionRef,
          actorId: 'actor',
          tag: 'commission.created',
          guard: (reader: GuardReader) =>
            Effect.gen(function* () {
              const plan = yield* reader.getDoc(
                planRef,
                Schema.Struct({ id: Schema.String, active: Schema.Boolean }),
              )
              if (!plan?.active) return { _tag: 'reject' as const, message: 'no plan' }
              return { _tag: 'ok' as const, payload: validCommissionPayload }
            }),
        },
        tx,
      ),
    )
    expect(outcome._tag).toBe('ok')
    expect(store.get(docKey(commissionRef))).toMatchObject({ id: 'c1' })
  })

  it('reject: returns reject + writes NOTHING when the guard rejects', async () => {
    const { tx, store } = bareTx()
    const outcome = await Effect.runPromise(
      appendEventGuardedToTx(
        {
          config: CommissionConfig,
          ref: commissionRef,
          actorId: 'actor',
          tag: 'commission.created',
          guard: () => Effect.succeed({ _tag: 'reject' as const, message: 'discontinued' }),
        },
        tx,
      ),
    )
    expect(outcome._tag).toBe('reject')
    expect(store.get(docKey(commissionRef))).toBeUndefined()
  })

  it('invalid: returns invalid when the resolved payload fails schema', async () => {
    const { tx } = bareTx()
    const outcome = await Effect.runPromise(
      appendEventGuardedToTx(
        {
          config: CommissionConfig,
          ref: commissionRef,
          actorId: 'actor',
          tag: 'commission.created',
          guard: () => Effect.succeed({ _tag: 'ok' as const, payload: { data: { bad: true } } }),
        },
        tx,
      ),
    )
    expect(outcome._tag).toBe('invalid')
  })
})
