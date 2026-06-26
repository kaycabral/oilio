// Unit tests for the saga bridge helpers (brief 0061) — `commitSaga` and
// `commitGuardedThenAppend`. The persistence Layer is mocked to an in-memory
// store (no Postgres/Firestore), so the bridge's success/failure mapping is
// covered cast-free: a clean run → `{ ok: true }`; a schema/guard reject →
// `{ ok: false, error }` with the whole tx rolled back.

import { CashMovementConfig, CommissionConfig } from '@/domain/aggregates'
import { aggregateRef, appendEventToTx } from '@/domain/effect'
import { docKey, makeReplayStore } from '@/domain/effect/test-layers'
import { Effect } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// In-memory replay layer (ref-keyed, real event log) standing in for the Postgres
// substrate (#1202): the bridge's success/rollback/defect mapping is what's under
// test, not the pg layer (proven by the `*.events.pg.integration.test.ts` suite).
const { store, layer: memoryLayer } = makeReplayStore()

// The mock factory is hoisted above `memoryLayer`'s definition, so expose the
// layer through a getter — the bridge reads `PostgresPersistenceLayer` lazily
// (inside `Effect.provide(...)` at call time), by when `memoryLayer` exists.
vi.mock('@/shared/db/pg/effect/postgres-layer', () => ({
  get PostgresPersistenceLayer() {
    return memoryLayer
  },
}))

const commissionRef = aggregateRef(CommissionConfig, 't1', 'c1')
const cashMovementRef = aggregateRef(CashMovementConfig, 't1', 'm1')

import { commitGuardedThenAppend, commitSaga } from './effect-bridge'

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

beforeEach(() => {
  store.clear()
})

describe('commitSaga', () => {
  it('returns ok and commits when every step succeeds', async () => {
    const result = await commitSaga([
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
    ])
    expect(result).toEqual({ ok: true })
    expect(store.get(docKey(commissionRef))).toBeDefined()
  })

  it('returns the error and rolls back when a step fails', async () => {
    const result = await commitSaga([
      (tx) =>
        appendEventToTx(
          CashMovementConfig,
          cashMovementRef,
          {
            _tag: 'cash_movement.created',
            actorId: 'actor',
            payload: { data: { ...commission, kind: 'not_a_kind' } },
          },
          tx,
        ),
    ])
    expect(result.ok).toBe(false)
    expect(store.get(docKey(cashMovementRef))).toBeUndefined()
  })

  it('maps a DB-level DEFECT (e.g. unique-violation) to a graceful {ok:false}', async () => {
    // A pg constraint refusal surfaces as a thrown defect, not a typed failure
    // (the layer throws inside Effect.promise). commitSaga must catch it and
    // return {ok:false} instead of rejecting → no unhandled 500.
    const result = await commitSaga([
      () => Effect.die(new Error('duplicate key value violates unique constraint (23505)')),
    ])
    expect(result.ok).toBe(false)
  })
})

describe('commitGuardedThenAppend', () => {
  it('runs the guarded step + the dependent step in one tx', async () => {
    const result = await commitGuardedThenAppend(
      {
        config: CommissionConfig,
        ref: commissionRef,
        actorId: 'actor',
        tag: 'commission.created',
        guard: () => Effect.succeed({ _tag: 'ok' as const, payload: { data: commission } }),
      },
      CashMovementConfig,
      cashMovementRef,
      () => ({
        _tag: 'cash_movement.created',
        actorId: 'actor',
        payload: {
          data: {
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
          },
        },
      }),
    )
    expect(result).toEqual({ ok: true })
    expect(store.get(docKey(commissionRef))).toBeDefined()
    expect(store.get(docKey(cashMovementRef))).toBeDefined()
  })

  it('returns the reject + writes nothing when the guard rejects', async () => {
    const result = await commitGuardedThenAppend(
      {
        config: CommissionConfig,
        ref: commissionRef,
        actorId: 'actor',
        tag: 'commission.created',
        guard: () => Effect.succeed({ _tag: 'reject' as const, message: 'discontinued' }),
      },
      CashMovementConfig,
      cashMovementRef,
      () => ({ _tag: 'cash_movement.created', actorId: 'actor', payload: { data: commission } }),
    )
    expect(result).toEqual({ ok: false, error: 'discontinued' })
    expect(store.get(docKey(commissionRef))).toBeUndefined()
  })
})
