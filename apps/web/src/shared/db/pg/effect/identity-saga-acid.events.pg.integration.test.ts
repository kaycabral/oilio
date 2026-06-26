import { MembershipConfig } from '@/domain/aggregates/membership/config'
import { OrgConfig } from '@/domain/aggregates/org/config'
import { aggregateRef, appendEventToTx, runSaga, type SagaStep } from '@/domain/effect'
import { defaultPermissionsForRole, type Membership } from '@/domain/types/membership'
import { DEFAULT_ORG_BRANDING, type StoredOrg } from '@/domain/types/org'
import { Effect } from 'effect'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeEventStoreDb, getEventStorePool } from '../pool'
import { PostgresPersistenceLayer } from './postgres-layer'

/**
 * ACID rollback of the IDENTITY sagas against REAL Postgres (#1199). The
 * create-org / accept-invite / change-role actions run their aggregate writes
 * through `commitSaga` → `runSaga` under the Postgres layer; this proves the
 * invariant those actions rely on: when a step mid-cascade violates a DB
 * constraint, the WHOLE transaction rolls back — zero rows for EVERY aggregate
 * the saga touched (org AND membership), never a partial state. The happy path
 * commits all aggregates together.
 *
 * We exercise the primitive (`runSaga` + `appendEventToTx`) directly with the
 * org+membership cascade shape that `createOrg` emits — the same path the action
 * takes via `commitSaga`. A membership with an empty `user_id` trips the
 * `memberships_user_id_nonempty` CHECK, forcing the rollback.
 *
 * globalSetup applies the migrations; OILIO_DATABASE_URL is the ephemeral `oilio`
 * database (docker locally, services:postgres in CI).
 */

const ORG = 'saga-org'
const USER = 'saga-user'

function org(id: string): StoredOrg {
  return {
    id,
    name: 'Barbearia do Zé',
    slug: `slug-${id}`,
    vertical: 'barbershop',
    website: null,
    ownerUserId: USER,
    branding: { ...DEFAULT_ORG_BRANDING },
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-01T12:00:00.000Z',
  }
}

function membership(orgId: string, userId: string): Membership {
  return {
    id: `${orgId}_${userId}`,
    orgId,
    userId,
    role: 'owner',
    status: 'active',
    invitedBy: null,
    joinedAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-01T12:00:00.000Z',
    rlsUnitScope: null,
    permissions: defaultPermissionsForRole('owner'),
  }
}

const orgRef = (id: string) => aggregateRef(OrgConfig, id, id)
const membershipRef = (orgId: string, id: string) => aggregateRef(MembershipConfig, orgId, id)

function orgStep(data: StoredOrg): SagaStep {
  return (tx) =>
    appendEventToTx(
      OrgConfig,
      orgRef(data.id),
      {
        _tag: 'org.created',
        actorId: 'test',
        payload: { data },
      },
      tx,
    )
}
function membershipStep(data: Membership): SagaStep {
  return (tx) =>
    appendEventToTx(
      MembershipConfig,
      membershipRef(data.orgId, data.id),
      {
        _tag: 'membership.created',
        actorId: 'test',
        payload: { data },
      },
      tx,
    )
}

async function readOrg(id: string): Promise<number> {
  const res = await getEventStorePool().query('SELECT 1 FROM orgs WHERE org_id = $1 AND id = $1', [
    id,
  ])
  return res.rowCount ?? 0
}
async function readMembership(orgId: string, id: string): Promise<number> {
  const res = await getEventStorePool().query(
    'SELECT 1 FROM memberships WHERE org_id = $1 AND id = $2',
    [orgId, id],
  )
  return res.rowCount ?? 0
}
async function countEvents(aggregateId: string): Promise<number> {
  const res = await getEventStorePool().query('SELECT 1 FROM events WHERE aggregate_id = $1', [
    aggregateId,
  ])
  return res.rowCount ?? 0
}

describe('identity saga — ACID rollback (Postgres)', () => {
  beforeEach(async () => {
    await getEventStorePool().query('TRUNCATE events, projections, memberships, orgs CASCADE')
  })
  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('commits org + membership together on the happy path', async () => {
    await Effect.runPromise(
      runSaga([orgStep(org(ORG)), membershipStep(membership(ORG, USER))]).pipe(
        Effect.provide(PostgresPersistenceLayer),
      ),
    )
    expect(await readOrg(ORG)).toBe(1)
    expect(await readMembership(ORG, `${ORG}_${USER}`)).toBe(1)
    // Both event streams persisted too.
    expect(await countEvents(ORG)).toBe(1)
    expect(await countEvents(`${ORG}_${USER}`)).toBe(1)
  })

  it('rolls back the WHOLE cascade when a later step violates a DB CHECK', async () => {
    // Step 2 carries an empty userId → trips `memberships_user_id_nonempty`.
    const badMembership = { ...membership(ORG, USER), userId: '' }
    const exit = await Effect.runPromiseExit(
      runSaga([orgStep(org(ORG)), membershipStep(badMembership)]).pipe(
        Effect.provide(PostgresPersistenceLayer),
      ),
    )
    expect(exit._tag).toBe('Failure')

    // The org step committed NOTHING — the failed membership rolled it back too.
    expect(await readOrg(ORG)).toBe(0)
    expect(await readMembership(ORG, `${ORG}_`)).toBe(0)
    // And no event row leaked for either aggregate.
    expect(await countEvents(ORG)).toBe(0)
  })
})
