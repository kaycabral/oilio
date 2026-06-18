// AC-09/AC-10 (brief 0025) — replay reconstrói o doc completo de membership
// (event-first: onboarding/aceite emitem `membership.created`, sem write-only).
// created (snapshot) → updated (changes) → replay == projeção, campo a campo.

import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'

import { appendEvent, replayAggregate } from '../effect/event-store'
import type { FirestoreDoc } from '../effect/services'
import { FirestoreService } from '../effect/services'
import { defaultPermissionsForRole } from '../types/membership'
import { MembershipConfig } from './membership/config'

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

describe('Membership — replay reconstrói o doc completo (event-first)', () => {
  it('created (snapshot completo) → updated (role) → replay == projeção', async () => {
    const { store, layer } = makeStore()
    const path = 'memberships/t1_user-1'
    const data = {
      id: 't1_user-1',
      orgId: 't1',
      userId: 'user-1',
      role: 'receptionist',
      status: 'active',
      invitedBy: 'owner-1',
      joinedAt: '2026-06-01T12:00:00.000Z',
      updatedAt: '2026-06-01T12:00:00.000Z',
      unitId: null,
      permissions: defaultPermissionsForRole('receptionist'),
      commissionRate: null,
    }

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* appendEvent(MembershipConfig, path, {
          _tag: 'membership.created',
          actorId: 'actor-1',
          payload: { data },
        })
        yield* appendEvent(MembershipConfig, path, {
          _tag: 'membership.updated',
          actorId: 'actor-1',
          payload: {
            changes: { role: 'manager', permissions: defaultPermissionsForRole('manager') },
          },
        })
      }).pipe(Effect.provide(layer)),
    )

    const projection = store.get(path)!
    const replayed = await Effect.runPromise(
      replayAggregate(MembershipConfig, path).pipe(Effect.provide(layer)),
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
    const { store, layer } = makeStore()
    const path = 'memberships/t1_user-2'
    const data = {
      id: 't1_user-2',
      orgId: 't1',
      userId: 'user-2',
      role: 'professional',
      status: 'active',
      invitedBy: 'owner-1',
      joinedAt: '2026-06-01T12:00:00.000Z',
      updatedAt: '2026-06-01T12:00:00.000Z',
      unitId: null,
      permissions: defaultPermissionsForRole('professional'),
      commissionRate: null,
    }

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* appendEvent(MembershipConfig, path, {
          _tag: 'membership.created',
          actorId: 'actor-1',
          payload: { data },
        })
        yield* appendEvent(MembershipConfig, path, {
          _tag: 'membership.updated',
          actorId: 'actor-1',
          payload: { changes: { status: 'revoked' } },
        })
      }).pipe(Effect.provide(layer)),
    )

    const projection = store.get(path)!
    const replayed = await Effect.runPromise(
      replayAggregate(MembershipConfig, path).pipe(Effect.provide(layer)),
    )

    expect(replayed).toEqual(projection)
    expect(replayed.status).toBe('revoked')
    // Role/permissions untouched by the offboarding (identity retained
    // identifiable — art. 16): only the status crosses to terminal.
    expect(replayed.role).toBe('professional')
  })
})
