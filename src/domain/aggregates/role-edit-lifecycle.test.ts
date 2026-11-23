import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { docKey, makeReplayStore } from '@/domain/effect/test-layers'
import { aggregateRef } from '../effect/aggregate-ref'
import { appendEvent, replayAggregate } from '../effect/event-store'
import { defaultPermissionsForRole } from '../types/membership'
import { MemberOperationConfig } from './member-operation/config'
import { MembershipConfig } from './membership/config'

describe('Role-edit — permissions re-derivadas no mesmo fluxo (#1086 AC-06)', () => {
  it('receptionist → memberOperation → receptionist: permissions seguem o default da role no replay', async () => {
    const { store, layer } = makeReplayStore()
    const ref = aggregateRef(MembershipConfig, 't1', 't1_user-1')
    const data = {
      id: 't1_user-1',
      orgId: 't1',
      userId: 'user-1',
      role: 'receptionist',
      status: 'active',
      invitedBy: 'owner-1',
      joinedAt: '2026-06-02T12:00:00.000Z',
      updatedAt: '2026-06-02T12:00:00.000Z',
      rlsUnitScope: null,
      permissions: defaultPermissionsForRole('receptionist'),
    }

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* appendEvent(MembershipConfig, ref, {
          _tag: 'membership.created',
          actorId: 'actor-1',
          payload: { data },
        })
        yield* appendEvent(MembershipConfig, ref, {
          _tag: 'membership.updated',
          actorId: 'actor-1',
          payload: {
            changes: {
              role: 'member_operator',
              permissions: defaultPermissionsForRole('member_operator'),
            },
          },
        })
      }).pipe(Effect.provide(layer)),
    )

    const promoted = await Effect.runPromise(
      replayAggregate(MembershipConfig, ref).pipe(Effect.provide(layer)),
    )
    expect(promoted).toEqual(store.get(docKey(ref)))
    expect(promoted.role).toBe('member_operator')
    expect(promoted.permissions).toEqual(defaultPermissionsForRole('member_operator'))
    expect(promoted.permissions.canHaveAgenda).toBe(true)
    expect(promoted.permissions.canManageCustomers).toBe(false)

    await Effect.runPromise(
      appendEvent(MembershipConfig, ref, {
        _tag: 'membership.updated',
        actorId: 'actor-1',
        payload: {
          changes: { role: 'receptionist', permissions: defaultPermissionsForRole('receptionist') },
        },
      }).pipe(Effect.provide(layer)),
    )
    const demoted = await Effect.runPromise(
      replayAggregate(MembershipConfig, ref).pipe(Effect.provide(layer)),
    )
    expect(demoted.role).toBe('receptionist')
    expect(demoted.permissions).toEqual(defaultPermissionsForRole('receptionist'))
    expect(demoted.permissions.canHaveAgenda).toBe(false)
    expect(demoted.permissions.canManageCustomers).toBe(true)
  })
})

describe('Role-edit — demoção preserva a projeção; suspended legado é no-op (#1086 AC-04/AC-05 + #1226 AC-02)', () => {
  it('legacy member_operation.suspended replays as a no-op: a projeção fica intacta, sem deletar', async () => {
    const { store, layer } = makeReplayStore()
    const ref = aggregateRef(MemberOperationConfig, 't1', 'pro1')

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* appendEvent(MemberOperationConfig, ref, {
          _tag: 'member_operation.created',
          actorId: 'actor-1',
          payload: {
            data: {
              id: 'pro1',
              orgId: 't1',
              userId: 'u-pro1',
              defaultCommission: null,
              unitIds: ['unit-1'],
              catalogServiceIds: ['svc-1'],
              createdAt: '2026-06-01T12:00:00.000Z',
              updatedAt: '2026-06-01T12:00:00.000Z',
            },
          },
        })
        yield* appendEvent(MemberOperationConfig, ref, {
          _tag: 'member_operation.suspended',
          actorId: 'actor-1',
          payload: {},
        })
      }).pipe(Effect.provide(layer)),
    )

    const deactivated = await Effect.runPromise(
      replayAggregate(MemberOperationConfig, ref).pipe(Effect.provide(layer)),
    )
    expect(deactivated).toEqual(store.get(docKey(ref)))
    expect(store.get(docKey(ref))).toBeDefined()
    expect('operationalStatus' in deactivated).toBe(false)
    expect(deactivated.unitIds).toEqual(['unit-1'])
    expect(deactivated.catalogServiceIds).toEqual(['svc-1'])
  })
})
