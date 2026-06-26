// #1226 AC-02 (DoD § Replay) — `operationalStatus` is NO LONGER materialized on
// the professional projection: it is DERIVED on read from real facts
// (whatsapp ∧ ≥1 unit ∧ ≥1 service). The `professional.activated` /
// `professional.suspended` events are no longer emitted, but HISTORICAL streams
// that emitted them must still REPLAY without breaking — the reducer treats them
// as no-ops. This test proves the replay-safety contract:
//   - a legacy stream (created → activated → suspended) replays cleanly;
//   - those transition events leave the state untouched (no-op);
//   - the replayed state carries no `operationalStatus` field;
//   - a legacy `professional.created` whose payload still carried
//     `operationalStatus` decodes (excess property ignored).
//
// Also exercises the pure derivation rule (the read-layer gate) so the
// "operational when accepted ∧ whatsapp ∧ ≥1 unit ∧ ≥1 service" rule stays pinned.

import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'

import { appendEvent, replayAggregate } from '../effect/event-store'
import type { FirestoreDoc } from '../effect/services'
import { PersistencePort } from '../effect/services'
import { ProfessionalConfig } from './professional/config'
import { deriveOperationalStatus } from './professional/derive-operational'

function makeStore() {
  const store = new Map<string, FirestoreDoc>()
  return {
    store,
    layer: Layer.succeed(PersistencePort, {
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

// A legacy `professional.created` payload — note it still carries the now-dropped
// `operationalStatus` key (a historical stream). Decode must tolerate it as an
// excess property (a drop, unlike a rename, needs no normalization).
const LEGACY_CREATED_DATA = {
  id: 'pro1',
  orgId: 't1',
  userId: 'u-pro1',
  operationalStatus: 'incomplete',
  defaultCommission: null,
  unitIds: [],
  catalogServiceIds: [],
  createdAt: '2026-06-01T12:00:00.000Z',
  updatedAt: '2026-06-01T12:00:00.000Z',
}

describe('Professional operational — legacy activate/suspend events replay as no-ops (#1226 AC-02)', () => {
  it('created → updated → activated → suspended replays cleanly with the transitions as no-ops', async () => {
    const { store, layer } = makeStore()
    const path = 'orgs/t1/professionals/pro1'

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* appendEvent(ProfessionalConfig, path, {
          _tag: 'professional.created',
          actorId: 'actor-1',
          payload: { data: LEGACY_CREATED_DATA },
        })
        yield* appendEvent(ProfessionalConfig, path, {
          _tag: 'professional.updated',
          actorId: 'actor-1',
          payload: { changes: { unitIds: ['u1'], catalogServiceIds: ['s1'] } },
        })
        // Legacy transition events — no longer emitted, but historical streams
        // have them. The reducer must accept + ignore them.
        yield* appendEvent(ProfessionalConfig, path, {
          _tag: 'professional.activated',
          actorId: 'actor-1',
          payload: {},
        })
        yield* appendEvent(ProfessionalConfig, path, {
          _tag: 'professional.suspended',
          actorId: 'actor-1',
          payload: {},
        })
      }).pipe(Effect.provide(layer)),
    )

    const replayed = await Effect.runPromise(
      replayAggregate(ProfessionalConfig, path).pipe(Effect.provide(layer)),
    )

    // Replay matches the projection and reconstructs the real state from the
    // stream alone — the transition events did not break decoding.
    expect(replayed).toEqual(store.get(path))
    expect(replayed._version).toBe(4)
    // The transitions are no-ops: the operational fields come only from
    // created/updated, untouched by activated/suspended.
    expect(replayed.unitIds).toEqual(['u1'])
    expect(replayed.catalogServiceIds).toEqual(['s1'])
    expect(replayed.userId).toBe('u-pro1')
    // The dropped column is absent from the projected state (excess key ignored
    // on the legacy created payload; never re-introduced by the no-op events).
    expect('operationalStatus' in replayed).toBe(false)
  })

  it('a legacy created event with the dropped operationalStatus key still decodes', async () => {
    const { layer } = makeStore()
    const path = 'orgs/t1/professionals/pro2'
    await Effect.runPromise(
      appendEvent(ProfessionalConfig, path, {
        _tag: 'professional.created',
        actorId: 'actor-1',
        payload: { data: { ...LEGACY_CREATED_DATA, id: 'pro2' } },
      }).pipe(Effect.provide(layer)),
    )
    const replayed = await Effect.runPromise(
      replayAggregate(ProfessionalConfig, path).pipe(Effect.provide(layer)),
    )
    expect(replayed.id).toBe('pro2')
    expect('operationalStatus' in replayed).toBe(false)
  })
})

describe('deriveOperationalStatus — regra V0 (read-layer gate, #1226 AC-02)', () => {
  it('cai em incomplete quando o convite ainda não foi aceito', () => {
    expect(
      deriveOperationalStatus({
        inviteAccepted: false,
        whatsapp: '5511999999999',
        unitIds: ['u1'],
        catalogServiceIds: ['s1'],
      }),
    ).toBe('incomplete')
  })

  it('incomplete quando aceito mas perfil incompleto', () => {
    expect(
      deriveOperationalStatus({
        inviteAccepted: true,
        whatsapp: null,
        unitIds: ['u1'],
        catalogServiceIds: ['s1'],
      }),
    ).toBe('incomplete')
    expect(
      deriveOperationalStatus({
        inviteAccepted: true,
        whatsapp: '5511999999999',
        unitIds: [],
        catalogServiceIds: ['s1'],
      }),
    ).toBe('incomplete')
    expect(
      deriveOperationalStatus({
        inviteAccepted: true,
        whatsapp: '5511999999999',
        unitIds: ['u1'],
        catalogServiceIds: [],
      }),
    ).toBe('incomplete')
    expect(
      deriveOperationalStatus({
        inviteAccepted: true,
        whatsapp: '   ',
        unitIds: ['u1'],
        catalogServiceIds: ['s1'],
      }),
    ).toBe('incomplete')
  })

  it('operational quando aceito ∧ whatsapp ∧ ≥1 unidade ∧ ≥1 serviço', () => {
    expect(
      deriveOperationalStatus({
        inviteAccepted: true,
        whatsapp: '5511999999999',
        unitIds: ['u1'],
        catalogServiceIds: ['s1'],
      }),
    ).toBe('operational')
  })
})
