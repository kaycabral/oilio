import { MembershipConfig } from '@/domain/aggregates/membership/config'
import { OrgConfig } from '@/domain/aggregates/org/config'
import { aggregateRef, appendEventToTx, runSaga, type SagaStep } from '@/domain/effect'
import { defaultPermissionsForRole, type Membership } from '@/domain/types/membership'
import { DEFAULT_ORG_BRANDING, type StoredOrg } from '@/domain/types/org'
import { Effect } from 'effect'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeEventStoreDb } from '../pool'
import { ownerPool } from '@/shared/db/pg/test/owner-pool'
import { PostgresPersistenceLayer } from './postgres-layer'

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
  const res = await ownerPool().query('SELECT 1 FROM orgs WHERE org_id = $1 AND id = $1', [
    id,
  ])
  return res.rowCount ?? 0
}
async function readMembership(orgId: string, id: string): Promise<number> {
  const res = await ownerPool().query(
    'SELECT 1 FROM memberships WHERE org_id = $1 AND id = $2',
    [orgId, id],
  )
  return res.rowCount ?? 0
}
async function countEvents(aggregateId: string): Promise<number> {
  const res = await ownerPool().query('SELECT 1 FROM events WHERE aggregate_id = $1', [
    aggregateId,
  ])
  return res.rowCount ?? 0
}

describe('identity saga — ACID rollback (Postgres)', () => {
  beforeEach(async () => {
    await ownerPool().query('TRUNCATE events, projections, memberships, orgs CASCADE')
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
    expect(await countEvents(ORG)).toBe(1)
    expect(await countEvents(`${ORG}_${USER}`)).toBe(1)
  })

  it('rolls back the WHOLE cascade when a later step violates a DB CHECK', async () => {
    const badMembership = { ...membership(ORG, USER), userId: '' }
    const exit = await Effect.runPromiseExit(
      runSaga([orgStep(org(ORG)), membershipStep(badMembership)]).pipe(
        Effect.provide(PostgresPersistenceLayer),
      ),
    )
    expect(exit._tag).toBe('Failure')

    expect(await readOrg(ORG)).toBe(0)
    expect(await readMembership(ORG, `${ORG}_`)).toBe(0)
    expect(await countEvents(ORG)).toBe(0)
  })
})
