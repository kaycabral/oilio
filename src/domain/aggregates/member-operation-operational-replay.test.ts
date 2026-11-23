import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { docKey, makeReplayStore } from '@/domain/effect/test-layers'
import { aggregateRef } from '../effect/aggregate-ref'
import { appendEvent, replayAggregate } from '../effect/event-store'
import { MemberOperationConfig } from './member-operation/config'
import { deriveOperationalStatus } from './member-operation/derive-operational'

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

describe('MemberOperation operational — legacy activate/suspend events replay as no-ops (#1226 AC-02)', () => {
  it('created → updated → activated → suspended replays cleanly with the transitions as no-ops', async () => {
    const { store, layer } = makeReplayStore()
    const ref = aggregateRef(MemberOperationConfig, 't1', 'pro1')

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* appendEvent(MemberOperationConfig, ref, {
          _tag: 'member_operation.created',
          actorId: 'actor-1',
          payload: { data: LEGACY_CREATED_DATA },
        })
        yield* appendEvent(MemberOperationConfig, ref, {
          _tag: 'member_operation.updated',
          actorId: 'actor-1',
          payload: { changes: { unitIds: ['u1'], catalogServiceIds: ['s1'] } },
        })
        yield* appendEvent(MemberOperationConfig, ref, {
          _tag: 'member_operation.activated',
          actorId: 'actor-1',
          payload: {},
        })
        yield* appendEvent(MemberOperationConfig, ref, {
          _tag: 'member_operation.suspended',
          actorId: 'actor-1',
          payload: {},
        })
      }).pipe(Effect.provide(layer)),
    )

    const replayed = await Effect.runPromise(
      replayAggregate(MemberOperationConfig, ref).pipe(Effect.provide(layer)),
    )

    expect(replayed).toEqual(store.get(docKey(ref)))
    expect(replayed._version).toBe(4)
    expect(replayed.unitIds).toEqual(['u1'])
    expect(replayed.catalogServiceIds).toEqual(['s1'])
    expect(replayed.userId).toBe('u-pro1')
    expect('operationalStatus' in replayed).toBe(false)
  })

  it('a legacy created event with the dropped operationalStatus key still decodes', async () => {
    const { layer } = makeReplayStore()
    const ref = aggregateRef(MemberOperationConfig, 't1', 'pro2')
    await Effect.runPromise(
      appendEvent(MemberOperationConfig, ref, {
        _tag: 'member_operation.created',
        actorId: 'actor-1',
        payload: { data: { ...LEGACY_CREATED_DATA, id: 'pro2' } },
      }).pipe(Effect.provide(layer)),
    )
    const replayed = await Effect.runPromise(
      replayAggregate(MemberOperationConfig, ref).pipe(Effect.provide(layer)),
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
        mobile: '5511999999999',
        unitIds: ['u1'],
        catalogServiceIds: ['s1'],
      }),
    ).toBe('incomplete')
  })

  it('incomplete quando aceito mas perfil incompleto', () => {
    expect(
      deriveOperationalStatus({
        inviteAccepted: true,
        mobile: null,
        unitIds: ['u1'],
        catalogServiceIds: ['s1'],
      }),
    ).toBe('incomplete')
    expect(
      deriveOperationalStatus({
        inviteAccepted: true,
        mobile: '5511999999999',
        unitIds: [],
        catalogServiceIds: ['s1'],
      }),
    ).toBe('incomplete')
    expect(
      deriveOperationalStatus({
        inviteAccepted: true,
        mobile: '5511999999999',
        unitIds: ['u1'],
        catalogServiceIds: [],
      }),
    ).toBe('incomplete')
    expect(
      deriveOperationalStatus({
        inviteAccepted: true,
        mobile: '   ',
        unitIds: ['u1'],
        catalogServiceIds: ['s1'],
      }),
    ).toBe('incomplete')
  })

  it('operational quando aceito ∧ mobile ∧ ≥1 unidade ∧ ≥1 serviço', () => {
    expect(
      deriveOperationalStatus({
        inviteAccepted: true,
        mobile: '5511999999999',
        unitIds: ['u1'],
        catalogServiceIds: ['s1'],
      }),
    ).toBe('operational')
  })
})
