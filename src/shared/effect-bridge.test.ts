import { CashMovementConfig, CommissionConfig } from '@/domain/aggregates'
import { aggregateRef, appendEventToTx, PersistencePort, SecurityContext } from '@/domain/effect'
import { docKey, makeReplayStore } from '@/domain/effect/test-layers'
import { Effect, Layer, Option } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { store, layer: memoryLayer } = makeReplayStore()

let injectedDefect: Error | null = null

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

vi.mock('@/shared/db/pg/effect/postgres-layer', () => ({
  get PostgresPersistenceLayer() {
    return activeLayer()
  },
}))

const commissionRef = aggregateRef(CommissionConfig, 't1', 'c1')
const cashMovementRef = aggregateRef(CashMovementConfig, 't1', 'm1')

function pgDefect(code: string): Error {
  return Object.assign(new Error(`pg error ${code}`), { code })
}

import {
  commitGuardedThenAppend,
  commitSaga,
  emitEvent,
  emitEventGuarded,
  securityLayer,
} from './effect-bridge'

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
    if (!result.ok) {
      expect(result.error).toMatch(/permissão/i)
      expect(result.error).not.toMatch(/concorrência/i)
    }
  })

  it('maps a 23P01 double-book exclusion to integrity, never a retriable message', async () => {
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
    if (!result.ok) {
      expect(result.error).not.toMatch(/23503/)
      expect(result.error).not.toMatch(/pg error/i)
    }
  })

  it('an unrecognised defect does not invite a retry (non-conflict = honest)', async () => {
    const result = await commitSaga([() => Effect.die(pgDefect('08006'))])
    expect(result.ok).toBe(false)
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
      {
        config: CashMovementConfig,
        ref: cashMovementRef,
        buildEvent: () => ({
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
      },
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
      {
        config: CashMovementConfig,
        ref: cashMovementRef,
        buildEvent: () => ({
          _tag: 'cash_movement.created',
          actorId: 'actor',
          payload: { data: commission },
        }),
      },
    )
    expect(result).toEqual({ ok: false, error: 'discontinued' })
    expect(store.get(docKey(commissionRef))).toBeUndefined()
  })
})

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

describe('securityLayer — org isolation across nested provides', () => {
  const currentOrg = Effect.serviceOption(SecurityContext).pipe(
    Effect.map((ctx) => Option.getOrNull(ctx)?.orgId ?? null),
  )

  const txOrgLayer = Layer.succeed(PersistencePort, {
    getDoc: () => Effect.succeed(null),
    getDocs: () => Effect.succeed([]),
    getEvents: () => Effect.succeed([]),
    setDoc: () => Effect.void,
    runTransaction: (fn) => fn({ getDoc: () => Effect.succeed(null), setDoc: () => Effect.void }),
  })

  const txOrg = Effect.gen(function* () {
    const persistence = yield* PersistencePort
    return yield* persistence.runTransaction(() => currentOrg)
  })

  it('an inner provide for another org wins inside, and the outer org is restored after', async () => {
    const program = Effect.gen(function* () {
      const before = yield* currentOrg
      const inner = yield* currentOrg.pipe(Effect.provide(securityLayer({ orgId: 'org-b' })))
      const after = yield* currentOrg
      return [before, inner, after]
    }).pipe(Effect.provide(securityLayer({ orgId: 'org-a' })))

    expect(await Effect.runPromise(program)).toEqual(['org-a', 'org-b', 'org-a'])
  })

  it('a persistence layer built by an outer provide reads the innermost org, never a memoized one', async () => {
    const program = Effect.gen(function* () {
      const outer = yield* txOrg
      const inner = yield* txOrg.pipe(Effect.provide(securityLayer({ orgId: 'org-b' })))
      return [outer, inner]
    }).pipe(Effect.provide(Layer.merge(txOrgLayer, securityLayer({ orgId: 'org-a' }))))

    expect(await Effect.runPromise(program)).toEqual(['org-a', 'org-b'])
  })

  it('concurrent sibling requests each see only their own org', async () => {
    const orgs = ['org-a', 'org-b', 'org-c', 'org-d']
    const program = Effect.all(
      orgs.map((orgId) =>
        Effect.yieldNow.pipe(
          Effect.andThen(txOrg),
          Effect.provide(Layer.merge(txOrgLayer, securityLayer({ orgId }))),
        ),
      ),
      { concurrency: 'unbounded' },
    )

    expect(await Effect.runPromise(program)).toEqual(orgs)
  })

  it('no security layer means no org in context', async () => {
    expect(await Effect.runPromise(currentOrg.pipe(Effect.provide(securityLayer())))).toBeNull()
  })
})
