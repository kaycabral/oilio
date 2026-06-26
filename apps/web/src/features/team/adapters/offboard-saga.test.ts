import type { FirestoreDoc, SagaStep, TransactionContext } from '@/domain/effect'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { buildOffboardSteps, type ResolvedOffboard } from './offboard-member'

async function runSteps(steps: SagaStep[]): Promise<Map<string, FirestoreDoc>> {
  const store = new Map<string, FirestoreDoc>()
  const tx: TransactionContext = {
    getDoc: (path) => Effect.succeed(store.get(path) ?? null),
    setDoc: (path, data) =>
      Effect.sync(() => {
        store.set(path, { ...store.get(path), ...data })
      }),
    deleteDoc: (path) =>
      Effect.sync(() => {
        store.delete(path)
      }),
  }
  for (const step of steps) await Effect.runPromise(step(tx))
  return store
}

/**
 * Pure unit test for the offboard saga STEP BUILDER (brief 0061 § Grupo C). It
 * turns the resolved cascade (membership + professional + appointments + blocks +
 * invites) into an ordered `SagaStep[]` — pure, no I/O. The ACID rollback
 * behavior is covered by `domain/effect/saga.test.ts` and the integration suite.
 */

describe('buildOffboardSteps', () => {
  it('a member with no professional projection is just the membership revoke', () => {
    const resolved: ResolvedOffboard = {
      membershipId: 't1_u1',
      previousStatus: 'active',
      professionalId: null,
      appointmentCancels: [],
      agendaBlockIds: [],
      inviteIds: [],
    }
    const steps = buildOffboardSteps(resolved, 't1', 'actor')
    expect(steps).toHaveLength(1)
  })

  it('a professional with the full cascade stacks every aggregate', () => {
    const resolved: ResolvedOffboard = {
      membershipId: 't1_u1',
      previousStatus: 'active',
      professionalId: 'pro-1',
      appointmentCancels: [
        { id: 'apt-1', cancelledAt: '2026-06-05T00:00:00.000Z', noticeMinutes: 120 },
        { id: 'apt-2', cancelledAt: '2026-06-05T00:00:00.000Z', noticeMinutes: 60 },
      ],
      agendaBlockIds: ['blk-1'],
      inviteIds: ['inv-1'],
    }
    const steps = buildOffboardSteps(resolved, 't1', 'actor')
    // membership revoke + 2 appointments + 1 block + 1 invite. No
    // `professional.suspended` step (#1226 AC-02): operationalStatus is derived
    // on read and the revoked membership already severs operability.
    expect(steps).toHaveLength(5)
  })

  it('the built steps execute: revoke + cancel + delete blocks/invites', async () => {
    const resolved: ResolvedOffboard = {
      membershipId: 't1_u1',
      previousStatus: 'active',
      professionalId: 'pro-1',
      appointmentCancels: [
        { id: 'apt-1', cancelledAt: '2026-06-05T00:00:00.000Z', noticeMinutes: 120 },
      ],
      agendaBlockIds: ['blk-1'],
      inviteIds: ['inv-1'],
    }
    const store = await runSteps(buildOffboardSteps(resolved, 't1', 'actor'))
    expect(store.get('memberships/t1_u1')).toMatchObject({ status: 'revoked' })
    expect(store.get('orgs/t1/appointments/apt-1')).toMatchObject({ status: 'cancelled' })
    // agenda_block + invite were `.deleted` → row dropped (event kept).
    expect(store.get('orgs/t1/agenda_blocks/blk-1')).toBeUndefined()
    expect(store.get('orgs/t1/agenda_blocks/blk-1/events/v000001')).toBeDefined()
    expect(store.get('orgs/t1/invites/inv-1')).toBeUndefined()
  })
})
