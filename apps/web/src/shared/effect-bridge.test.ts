// Unit tests for the saga bridge helpers (brief 0061) — `commitSaga` and
// `commitGuardedThenAppend`. The persistence Layer is mocked to an in-memory
// store (no Postgres/Firestore), so the bridge's success/failure mapping is
// covered cast-free: a clean run → `{ ok: true }`; a schema/guard reject →
// `{ ok: false, error }` with the whole tx rolled back.

import { CashMovementConfig, CommissionConfig } from '@/domain/aggregates'
import { aggregateRef, appendEventToTx, PersistencePort } from '@/domain/effect'
import { docKey, makeReplayStore } from '@/domain/effect/test-layers'
import { Effect, Layer } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// In-memory replay layer (ref-keyed, real event log) standing in for the Postgres
// substrate (#1202): the bridge's success/rollback/defect mapping is what's under
// test, not the pg layer (proven by the `*.events.pg.integration.test.ts` suite).
const { store, layer: memoryLayer } = makeReplayStore()

// When set, the mocked layer makes every `runTransaction` die with this defect —
// simulating a pg constraint refusal thrown deep in the live layer (#1344). This
// is how the single-aggregate writers' `catchAllDefect` net gets exercised in a
// unit test: the bridge sees a raw defect and must map it to `{ok:false}`.
let injectedDefect: Error | null = null

// A layer whose `runTransaction` dies with `injectedDefect` (when set), else
// delegates to the real in-memory port. Built lazily inside the getter so the
// hoisted mock factory doesn't touch `memoryLayer`/`injectedDefect` too early.
// The single-aggregate writers only reach `runTransaction`; the read methods are
// never hit on this path, so they die loudly if they somehow are.
function activeLayer() {
  if (!injectedDefect) return memoryLayer
  const defect = injectedDefect
  const unreached = () => Effect.die(new Error('unexpected read on the dying layer'))
  return Layer.succeed(PersistencePort, {
    getDoc: unreached,
    getDocs: unreached,
    getEvents: unreached,
    setDoc: unreached,
    runTransaction: () => Effect.die(defect),
  })
}

// The mock factory is hoisted above the definitions, so expose the layer through
// a getter — the bridge reads `PostgresPersistenceLayer` lazily (inside
// `Effect.provide(...)` at call time), by when the definitions exist.
vi.mock('@/shared/db/pg/effect/postgres-layer', () => ({
  get PostgresPersistenceLayer() {
    return activeLayer()
  },
}))

const commissionRef = aggregateRef(CommissionConfig, 't1', 'c1')
const cashMovementRef = aggregateRef(CashMovementConfig, 't1', 'm1')

// A pg constraint refusal surfaces as a thrown DEFECT, not a typed failure (the
// layer throws inside Effect.promise). The bridge writers must catch it and
// return {ok:false} instead of rejecting → no unhandled 500. The message must be
// HONEST about which kind it was (#1320): only a 23505 version clash is a
// retriable concurrency conflict; a FK/CHECK/RLS refusal is deterministic.
function pgDefect(code: string): Error {
  // Shape a pg `DatabaseError`-like object (carries `code`) the guards inspect.
  return Object.assign(new Error(`pg error ${code}`), { code })
}

import { commitGuardedThenAppend, commitSaga, emitEvent, emitEventGuarded } from './effect-bridge'

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

afterEach(() => {
  injectedDefect = null
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

  it('maps a 23505 version clash to the concurrency-conflict message (retriable)', async () => {
    const result = await commitSaga([() => Effect.die(pgDefect('23505'))])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/conflito de concorrência/i)
  })

  it('maps a FK violation (23503) to the integrity message, NOT concurrency (#1320)', async () => {
    const result = await commitSaga([() => Effect.die(pgDefect('23503'))])
    expect(result.ok).toBe(false)
    // The bug this fixes: a FK refusal used to masquerade as "tente de novo".
    if (!result.ok) {
      expect(result.error).toMatch(/restrição de integridade/i)
      expect(result.error).not.toMatch(/concorrência/i)
    }
  })

  it('maps a CHECK violation (23514) to the integrity message, not concurrency', async () => {
    const result = await commitSaga([() => Effect.die(pgDefect('23514'))])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).not.toMatch(/concorrência/i)
  })

  it('maps an RLS refusal (42501) to a neutral permission message, not integrity/concurrency', async () => {
    const result = await commitSaga([() => Effect.die(pgDefect('42501'))])
    expect(result.ok).toBe(false)
    // RLS is `forbidden`, distinct from `integrity` — and never confirms row state.
    if (!result.ok) {
      expect(result.error).toMatch(/permissão/i)
      expect(result.error).not.toMatch(/concorrência/i)
    }
  })

  it('maps a 23P01 double-book exclusion to integrity, never a retriable message', async () => {
    // The no-double-book GiST constraint is a deterministic refusal (a concurrent
    // reschedule taking the slot). It must NOT read as "tente de novo" (#1320).
    const result = await commitSaga([() => Effect.die(pgDefect('23P01'))])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/restrição de integridade/i)
      expect(result.error).not.toMatch(/de novo/i)
    }
  })

  it('never leaks the raw SQLSTATE or pg error text to the client', async () => {
    const result = await commitSaga([() => Effect.die(pgDefect('23503'))])
    expect(result.ok).toBe(false)
    // The generic message must not carry the code or the "pg error ..." text.
    if (!result.ok) {
      expect(result.error).not.toMatch(/23503/)
      expect(result.error).not.toMatch(/pg error/i)
    }
  })

  it('an unrecognised defect does not invite a retry (non-conflict = honest)', async () => {
    const result = await commitSaga([() => Effect.die(pgDefect('08006'))])
    expect(result.ok).toBe(false)
    // `unknown` must not say "tente de novo" — only a real 23505 conflict does.
    if (!result.ok) expect(result.error).not.toMatch(/de novo/i)
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

// #1344: the single-aggregate writers gain the same DB-defect net the saga
// writers already had. A raw pg refusal (thrown as a defect by the live layer)
// must map to `{ok:false}` with the honest per-category message — never escape as
// an unhandled 500, never leak the SQLSTATE — while the existing typed `catchTag`
// handling (validation reject) stays intact.
describe('emitEvent — DB-defect net', () => {
  it('commits and returns ok on a clean append', async () => {
    const result = await emitEvent(CommissionConfig, commissionRef, {
      _tag: 'commission.created',
      actorId: 'actor',
      payload: { data: commission },
    })
    expect(result).toEqual({ ok: true })
    expect(store.get(docKey(commissionRef))).toBeDefined()
  })

  it('maps a 23505 version clash to the retriable concurrency message', async () => {
    injectedDefect = pgDefect('23505')
    const result = await emitEvent(CommissionConfig, commissionRef, {
      _tag: 'commission.created',
      actorId: 'actor',
      payload: { data: commission },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/conflito de concorrência/i)
  })

  it('maps a FK violation (23503) to integrity, not concurrency (#1320)', async () => {
    injectedDefect = pgDefect('23503')
    const result = await emitEvent(CommissionConfig, commissionRef, {
      _tag: 'commission.created',
      actorId: 'actor',
      payload: { data: commission },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).not.toMatch(/de novo/i)
  })

  it('never leaks the raw SQLSTATE or pg error text to the client', async () => {
    injectedDefect = pgDefect('23503')
    const result = await emitEvent(CommissionConfig, commissionRef, {
      _tag: 'commission.created',
      actorId: 'actor',
      payload: { data: commission },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).not.toMatch(/23503/)
      expect(result.error).not.toMatch(/pg error/i)
    }
  })
})

describe('emitEventGuarded — DB-defect net', () => {
  const guardedOk = {
    config: CommissionConfig,
    ref: commissionRef,
    actorId: 'actor',
    tag: 'commission.created' as const,
    guard: () => Effect.succeed({ _tag: 'ok' as const, payload: { data: commission } }),
  }

  it('preserves a GuardRejectedError message verbatim (tag not swallowed by the net)', async () => {
    const result = await emitEventGuarded({
      ...guardedOk,
      guard: () => Effect.succeed({ _tag: 'reject' as const, message: 'discontinued' }),
    })
    expect(result).toEqual({ ok: false, error: 'discontinued' })
  })

  it('maps a DB defect to the honest per-category message, not a 500', async () => {
    injectedDefect = pgDefect('23514')
    const result = await emitEventGuarded(guardedOk)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).not.toMatch(/23514/)
      expect(result.error).not.toMatch(/de novo/i)
    }
  })
})
