// AC-09/AC-10 (brief 0025) — replay reconstrói o doc completo de membership
// (event-first: onboarding/aceite emitem `membership.created`, sem write-only).
// created (snapshot) → updated (changes) → replay == projeção, campo a campo.

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

  // Offboarding (brief 0041 #1103, AC-10) — ending a member's access projects
  // the terminal `revoked` status via `membership.updated { status }`. Replay
  // reconstructs the terminal status from the stream alone (event-first proof:
  // the severance lives in the immutable event, not a bare doc write).
  it('created → updated (status revoked) → replay projeta status terminal', async () => {
    const { store, layer } = makeReplayStore()
    const ref = aggregateRef(MembershipConfig, 't1', 't1_user-2')
    const data = {
      id: 't1_user-2',
      orgId: 't1',
      userId: 'user-2',
      role: 'professional',
      status: 'active',
      invitedBy: 'owner-1',
      joinedAt: '2026-06-01T12:00:00.000Z',
      updatedAt: '2026-06-01T12:00:00.000Z',
      rlsUnitScope: null,
      permissions: defaultPermissionsForRole('professional'),
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
    // Role/permissions untouched by the offboarding (identity retained
    // identifiable — art. 16): only the status crosses to terminal.
    expect(replayed.role).toBe('professional')
  })

  // #1226 AC-01/AC-03 replay-safety: a LEGACY `membership.created` event whose
  // payload carries the pre-rename `unitId` key (renamed to `rlsUnitScope`) AND
  // the now-dropped `commissionRate` key must still replay (brief 0068 D4). The
  // event WIRE contract is immutable: the rename is normalized at the decode
  // boundary (no upcaster) and the dropped key is ignored as an excess property.
  // Seeds a raw legacy event doc directly (bypassing `appendEvent`, which writes
  // the new shape) to reproduce a historical stream.
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
          // Legacy wire key — the pre-rename name (normalized on decode).
          unitId: 'unit-legacy',
          permissions: defaultPermissionsForRole('receptionist'),
          // Dropped field (#1226 AC-01) — tolerated as an excess property.
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
    // The dropped column is gone from the projected state (excess key ignored).
    expect('commissionRate' in replayed).toBe(false)
  })
})
