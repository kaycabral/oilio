// #1047 / brief 0028 AC-07 (DoD § Replay) — `operationalStatus` is event-sourced:
// it reconstructs from the domain event stream ALONE
// (`professional.created` → `professional.activated`/`professional.suspended`),
// with no direct write. Proves the operational cycle is replay-faithful: the
// projection is descartável and the events are the source of truth.
//
// Also exercises the pure derivation rule (AC-06) so the "operational when
// accepted ∧ whatsapp ∧ ≥1 unit ∧ ≥1 service" gate stays pinned.

import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'

import { appendEvent, replayAggregate } from '../effect/event-store'
import type { FirestoreDoc } from '../effect/services'
import { FirestoreService } from '../effect/services'
import { ProfessionalConfig } from './professional/config'
import { deriveOperationalStatus } from './professional/derive-operational'

function makeStore() {
  const store = new Map<string, FirestoreDoc>()
  return {
    store,
    layer: Layer.succeed(FirestoreService, {
      getDoc: (path: string) => Effect.succeed(store.get(path) ?? null),
      getDocs: (collectionPath: string) =>
        Effect.succeed(
          [...store.entries()]
            .filter(([key]) => key.startsWith(collectionPath + '/'))
            .map(([, doc]) => doc)
            .sort(
              (a, b) =>
                (typeof a['version'] === 'number' ? a['version'] : 0) -
                (typeof b['version'] === 'number' ? b['version'] : 0),
            ),
        ),
      setDoc: (path: string, data: FirestoreDoc) =>
        Effect.sync(() => {
          store.set(path, { ...store.get(path), ...data })
        }),
      runTransaction: (fn) =>
        fn({
          getDoc: (path) => Effect.succeed(store.get(path) ?? null),
          setDoc: (path, data) =>
            Effect.sync(() => {
              store.set(path, { ...store.get(path), ...data })
            }),
        }),
    }),
  }
}

const CREATED_DATA = {
  id: 'pro1',
  orgId: 't1',
  userId: 'u-pro1',
  // Born from the accept saga with an incomplete profile (#1045): no units/
  // services yet, so the operational status starts at `incomplete`.
  operationalStatus: 'incomplete',
  defaultCommission: null,
  unitIds: [],
  serviceIds: [],
  createdAt: '2026-06-01T12:00:00.000Z',
  updatedAt: '2026-06-01T12:00:00.000Z',
}

describe('Professional operational — replay reconstrói operationalStatus só por evento (#1047)', () => {
  it('created (incomplete) → activated → suspended reconstrói pelo stream', async () => {
    const { store, layer } = makeStore()
    const path = 'orgs/t1/professionals/pro1'

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* appendEvent(ProfessionalConfig, path, {
          _tag: 'professional.created',
          actorId: 'actor-1',
          payload: { data: CREATED_DATA },
        })
        // Profile completed (units+services+whatsapp) → derived activation fires.
        yield* appendEvent(ProfessionalConfig, path, {
          _tag: 'professional.updated',
          actorId: 'actor-1',
          payload: { changes: { unitIds: ['u1'], serviceIds: ['s1'] } },
        })
        yield* appendEvent(ProfessionalConfig, path, {
          _tag: 'professional.activated',
          actorId: 'actor-1',
          payload: {},
        })
      }).pipe(Effect.provide(layer)),
    )

    const afterApprove = await Effect.runPromise(
      replayAggregate(ProfessionalConfig, path).pipe(Effect.provide(layer)),
    )
    expect(afterApprove).toEqual(store.get(path))
    expect(afterApprove.operationalStatus).toBe('operational')
    expect(afterApprove._version).toBe(3)

    // Falling back out of `operational` (e.g. last service removed) → suspended
    // projects to `incomplete` (off the public agenda; reserved hook).
    await Effect.runPromise(
      appendEvent(ProfessionalConfig, path, {
        _tag: 'professional.suspended',
        actorId: 'actor-1',
        payload: {},
      }).pipe(Effect.provide(layer)),
    )
    const afterSuspend = await Effect.runPromise(
      replayAggregate(ProfessionalConfig, path).pipe(Effect.provide(layer)),
    )
    expect(afterSuspend).toEqual(store.get(path))
    expect(afterSuspend.operationalStatus).toBe('incomplete')
    expect(afterSuspend._version).toBe(4)
  })

  it('replay sem evento de ativação mantém operationalStatus em incomplete', async () => {
    const { layer } = makeStore()
    const path = 'orgs/t1/professionals/pro2'
    await Effect.runPromise(
      appendEvent(ProfessionalConfig, path, {
        _tag: 'professional.created',
        actorId: 'actor-1',
        payload: { data: { ...CREATED_DATA, id: 'pro2' } },
      }).pipe(Effect.provide(layer)),
    )
    const replayed = await Effect.runPromise(
      replayAggregate(ProfessionalConfig, path).pipe(Effect.provide(layer)),
    )
    expect(replayed.operationalStatus).toBe('incomplete')
  })
})

describe('deriveOperationalStatus — regra V0 (#1047 AC-06)', () => {
  it('cai em incomplete quando o convite ainda não foi aceito', () => {
    expect(
      deriveOperationalStatus({
        inviteAccepted: false,
        whatsapp: '5511999999999',
        unitIds: ['u1'],
        serviceIds: ['s1'],
      }),
    ).toBe('incomplete')
  })

  it('incomplete quando aceito mas perfil incompleto', () => {
    expect(
      deriveOperationalStatus({
        inviteAccepted: true,
        whatsapp: null,
        unitIds: ['u1'],
        serviceIds: ['s1'],
      }),
    ).toBe('incomplete')
    expect(
      deriveOperationalStatus({
        inviteAccepted: true,
        whatsapp: '5511999999999',
        unitIds: [],
        serviceIds: ['s1'],
      }),
    ).toBe('incomplete')
    expect(
      deriveOperationalStatus({
        inviteAccepted: true,
        whatsapp: '5511999999999',
        unitIds: ['u1'],
        serviceIds: [],
      }),
    ).toBe('incomplete')
    expect(
      deriveOperationalStatus({
        inviteAccepted: true,
        whatsapp: '   ',
        unitIds: ['u1'],
        serviceIds: ['s1'],
      }),
    ).toBe('incomplete')
  })

  it('operational quando aceito ∧ whatsapp ∧ ≥1 unidade ∧ ≥1 serviço', () => {
    expect(
      deriveOperationalStatus({
        inviteAccepted: true,
        whatsapp: '5511999999999',
        unitIds: ['u1'],
        serviceIds: ['s1'],
      }),
    ).toBe('operational')
  })
})
