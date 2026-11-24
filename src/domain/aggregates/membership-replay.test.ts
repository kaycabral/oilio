import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { docKey, makeReplayStore } from '@/domain/effect/test-layers'
import { aggregateRef } from '../effect/aggregate-ref'
import { appendEvent, replayAggregate } from '../effect/event-store'
import { defaultPermissionsForRole } from '../types/membership'
import { MembershipConfig } from './membership/config'

describe('Membership — replay reconstrói o doc completo (event-first)', () => {
  it('created (snapshot completo) → updated (role) → replay == projeção', async () => {
    const { store, layer } = makeReplayStore()
    const ref = aggregateRef(MembershipConfig, 't1', 't1_user-1')
    const data = {
      id: 't1_user-1',
      orgId: 't1',
      userId: 'user-1',
      role: 'receptionist',
      status: 'active',
      invitedBy: 'owner-1',
      joinedAt: '2026-06-01T12:00:00.000Z',
      updatedAt: '2026-06-01T12:00:00.000Z',
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
            changes: { role: 'manager', permissions: defaultPermissionsForRole('manager') },
          },
        })
      }).pipe(Effect.provide(layer)),
    )

    const projection = store.get(docKey(ref))!
    const replayed = await Effect.runPromise(
      replayAggregate(MembershipConfig, ref).pipe(Effect.provide(layer)),
    )

    expect(replayed).toEqual(projection)
    expect(replayed._version).toBe(2)
    expect(replayed.role).toBe('manager')
    expect(replayed.permissions).toEqual(defaultPermissionsForRole('manager'))
  })

  it('created → updated (status revoked) → replay projeta status terminal', async () => {
    const { store, layer } = makeReplayStore()
    const ref = aggregateRef(MembershipConfig, 't1', 't1_user-2')
    const data = {
      id: 't1_user-2',
      orgId: 't1',
      userId: 'user-2',
      role: 'member_operator',
      status: 'active',
      invitedBy: 'owner-1',
      joinedAt: '2026-06-01T12:00:00.000Z',
      updatedAt: '2026-06-01T12:00:00.000Z',
      rlsUnitScope: null,
      permissions: defaultPermissionsForRole('member_operator'),
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
          payload: { changes: { status: 'revoked' } },
        })
      }).pipe(Effect.provide(layer)),
    )

    const projection = store.get(docKey(ref))!
    const replayed = await Effect.runPromise(
      replayAggregate(MembershipConfig, ref).pipe(Effect.provide(layer)),
    )

    expect(replayed).toEqual(projection)
    expect(replayed.status).toBe('revoked')
    expect(replayed.role).toBe('member_operator')
  })

  it('replay of a legacy `unitId` + `commissionRate` payload is normalized and tolerated', async () => {
    const { events, layer } = makeReplayStore()
    const ref = aggregateRef(MembershipConfig, 't1', 't1_user-legacy')
    const legacyEventDoc = {
      _tag: 'membership.created',
      version: 1,
      timestamp: '2026-06-01T12:00:00.000Z',
      actorId: 'actor-1',
      schemaVersion: 1,
      payload: {
        data: {
          id: 't1_user-legacy',
          orgId: 't1',
          userId: 'user-legacy',
          role: 'receptionist',
          status: 'active',
          invitedBy: 'owner-1',
          joinedAt: '2026-06-01T12:00:00.000Z',
          updatedAt: '2026-06-01T12:00:00.000Z',
          unitId: 'unit-legacy',
          permissions: defaultPermissionsForRole('receptionist'),
          commissionRate: null,
        },
      },
    }
    events.set(docKey(ref), [legacyEventDoc])

    const replayed = await Effect.runPromise(
      replayAggregate(MembershipConfig, ref).pipe(Effect.provide(layer)),
    )

    expect(replayed.rlsUnitScope).toBe('unit-legacy')
    expect(replayed.role).toBe('receptionist')
    expect(replayed._version).toBe(1)
    expect('commissionRate' in replayed).toBe(false)
  })
})
