// brief 0037 #1086 (AC-04/AC-05/AC-06) — role-edit lifecycle, domain layer.
//
// `changeMemberRole` (server action) is a saga over two aggregates. The pieces
// it relies on are pure/replayable and pinned here so the behavior stays
// anchored to this issue:
//   - AC-06: permissions are re-derived from the role default in the same
//     `membership.updated` event; replay reconstructs role + permissions in
//     lock-step (no stale gate).
//   - AC-04/AC-05: a demotion away from professional leaves the projection in
//     place (never deleted; reversible). `operationalStatus` is now DERIVED on
//     read (#1226 AC-02), so legacy `professional.suspended` events are no-ops —
//     replay tolerates them and preserves the projection's operational data.

import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'

import { appendEvent, replayAggregate } from '../effect/event-store'
import type { FirestoreDoc } from '../effect/services'
import { PersistencePort } from '../effect/services'
import { defaultPermissionsForRole } from '../types/membership'
import { MembershipConfig } from './membership/config'
import { ProfessionalConfig } from './professional/config'

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

describe('Role-edit — permissions re-derivadas no mesmo fluxo (#1086 AC-06)', () => {
  it('receptionist → professional → receptionist: permissions seguem o default da role no replay', async () => {
    const { store, layer } = makeStore()
    const path = 'memberships/t1_user-1'
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
        yield* appendEvent(MembershipConfig, path, {
          _tag: 'membership.created',
          actorId: 'actor-1',
          payload: { data },
        })
        // Promote → professional: role + permissions re-derived in one event.
        yield* appendEvent(MembershipConfig, path, {
          _tag: 'membership.updated',
          actorId: 'actor-1',
          payload: {
            changes: {
              role: 'professional',
              permissions: defaultPermissionsForRole('professional'),
            },
          },
        })
      }).pipe(Effect.provide(layer)),
    )

    const promoted = await Effect.runPromise(
      replayAggregate(MembershipConfig, path).pipe(Effect.provide(layer)),
    )
    expect(promoted).toEqual(store.get(path))
    expect(promoted.role).toBe('professional')
    // The professional default grants own-agenda and revokes receptionist ops —
    // no stale gate from the receptionist defaults.
    expect(promoted.permissions).toEqual(defaultPermissionsForRole('professional'))
    expect(promoted.permissions.canHaveAgenda).toBe(true)
    expect(promoted.permissions.canManageCustomers).toBe(false)

    // Demote back → receptionist: permissions re-derive again.
    await Effect.runPromise(
      appendEvent(MembershipConfig, path, {
        _tag: 'membership.updated',
        actorId: 'actor-1',
        payload: {
          changes: { role: 'receptionist', permissions: defaultPermissionsForRole('receptionist') },
        },
      }).pipe(Effect.provide(layer)),
    )
    const demoted = await Effect.runPromise(
      replayAggregate(MembershipConfig, path).pipe(Effect.provide(layer)),
    )
    expect(demoted.role).toBe('receptionist')
    expect(demoted.permissions).toEqual(defaultPermissionsForRole('receptionist'))
    expect(demoted.permissions.canHaveAgenda).toBe(false)
    expect(demoted.permissions.canManageCustomers).toBe(true)
  })
})

describe('Role-edit — demoção preserva a projeção; suspended legado é no-op (#1086 AC-04/AC-05 + #1226 AC-02)', () => {
  it('legacy professional.suspended replays as a no-op: a projeção fica intacta, sem deletar', async () => {
    const { store, layer } = makeStore()
    const path = 'orgs/t1/professionals/pro1'

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* appendEvent(ProfessionalConfig, path, {
          _tag: 'professional.created',
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
        // Legacy demotion event — no longer emitted, but historical streams have
        // it. `operationalStatus` is derived on read now, so this is a no-op.
        yield* appendEvent(ProfessionalConfig, path, {
          _tag: 'professional.suspended',
          actorId: 'actor-1',
          payload: {},
        })
      }).pipe(Effect.provide(layer)),
    )

    const deactivated = await Effect.runPromise(
      replayAggregate(ProfessionalConfig, path).pipe(Effect.provide(layer)),
    )
    expect(deactivated).toEqual(store.get(path))
    // AC-05: the projection is NOT deleted — it stays in the store, untouched by
    // the no-op transition. Reversible, history kept.
    expect(store.get(path)).toBeDefined()
    // The status is no longer materialized on the projection (derived on read).
    expect('operationalStatus' in deactivated).toBe(false)
    // The operational data (units/services) is preserved for reversibility.
    expect(deactivated.unitIds).toEqual(['unit-1'])
    expect(deactivated.catalogServiceIds).toEqual(['svc-1'])
  })
})
