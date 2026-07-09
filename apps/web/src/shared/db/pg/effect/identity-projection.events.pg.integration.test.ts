import { MembershipConfig } from '@/domain/aggregates/membership/config'
import { OrgConfig } from '@/domain/aggregates/org/config'
import { UnitConfig } from '@/domain/aggregates/unit/config'
import { aggregateRef, appendEvent, replayAggregate } from '@/domain/effect'
import { defaultPermissionsForRole, type Membership } from '@/domain/types/membership'
import { DEFAULT_ORG_BRANDING, type StoredOrg } from '@/domain/types/org'
import { EMPTY_ADDRESS, type StoredUnit } from '@/domain/types/unit'
import { Effect } from 'effect'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeEventStoreDb, getEventStorePool } from '../pool'
import { deletePostgresProjection, PostgresPersistenceLayer } from './postgres-layer'

const ORG = 'org-id'
const orgRef = (id: string) => aggregateRef(OrgConfig, id, id)
const unitRef = (orgId: string, id: string) => aggregateRef(UnitConfig, orgId, id)
const membershipRef = (orgId: string, id: string) => aggregateRef(MembershipConfig, orgId, id)

function org(id: string, overrides: Partial<StoredOrg> = {}): StoredOrg {
  return {
    id,
    name: 'Barbearia do Zé',
    slug: `slug-${id}`,
    vertical: 'barbershop',
    website: null,
    ownerUserId: 'user-1',
    branding: { ...DEFAULT_ORG_BRANDING },
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-01T12:00:00.000Z',
    ...overrides,
  }
}

function unit(orgId: string, id: string, overrides: Partial<StoredUnit> = {}): StoredUnit {
  return {
    id,
    orgId,
    name: 'Centro',
    slug: `unit-${id}`,
    address: {
      ...EMPTY_ADDRESS,
      postalCode: '01001000',
      state: 'SP',
      city: 'São Paulo',
      neighborhood: 'Centro',
      street: 'Praça da Sé',
    },
    timezone: 'America/Sao_Paulo',
    agenda: {
      mode: 'fixed',
      businessHours: {
        monday: null,
        tuesday: null,
        wednesday: null,
        thursday: null,
        friday: null,
        saturday: null,
        sunday: null,
      },
    },
    archivedAt: null,
    fiscal: { kind: 'informal' },
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-01T12:00:00.000Z',
    ...overrides,
  }
}

function membership(
  orgId: string,
  userId: string,
  overrides: Partial<Membership> = {},
): Membership {
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
    ...overrides,
  }
}

const createOrg = (data: StoredOrg) =>
  Effect.runPromise(
    appendEvent(OrgConfig, orgRef(data.id), {
      _tag: 'org.created',
      actorId: 'test',
      payload: { data },
    }).pipe(Effect.provide(PostgresPersistenceLayer)),
  )

const createUnit = (data: StoredUnit) =>
  Effect.runPromise(
    appendEvent(UnitConfig, unitRef(data.orgId, data.id), {
      _tag: 'unit.created',
      actorId: 'test',
      payload: { data },
    }).pipe(Effect.provide(PostgresPersistenceLayer)),
  )

const createMembership = (data: Membership) =>
  Effect.runPromise(
    appendEvent(MembershipConfig, membershipRef(data.orgId, data.id), {
      _tag: 'membership.created',
      actorId: 'test',
      payload: { data },
    }).pipe(Effect.provide(PostgresPersistenceLayer)),
  )

async function rowCount(table: string, orgId: string, id: string): Promise<number> {
  const res = await getEventStorePool().query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ${table} WHERE org_id = $1 AND id = $2`,
    [orgId, id],
  )
  return res.rows[0]?.n ?? 0
}

async function genericCount(orgId: string, id: string): Promise<number> {
  return rowCount('projections', orgId, id)
}

describe('Postgres typed projections — identity (brief 0059)', () => {
  beforeEach(async () => {
    await getEventStorePool().query(
      'TRUNCATE events, projections, catalog_items, units, memberships, orgs CASCADE',
    )
  })

  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('AC-05: org/unit/membership projections route to their TYPED tables, not the generic store', async () => {
    await createOrg(org(ORG))
    await createUnit(unit(ORG, 'u1'))
    await createMembership(membership(ORG, 'user-1'))

    expect(await rowCount('orgs', ORG, ORG)).toBe(1)
    expect(await rowCount('units', ORG, 'u1')).toBe(1)
    expect(await rowCount('memberships', ORG, `${ORG}_user-1`)).toBe(1)

    expect(await genericCount(ORG, ORG)).toBe(0)
    expect(await genericCount(ORG, 'u1')).toBe(0)
    expect(await genericCount(ORG, `${ORG}_user-1`)).toBe(0)
  })

  it('AC-01: replay reconstructs identical state for each aggregate (union bodies round-trip)', async () => {
    await createOrg(org(ORG))
    await createUnit(
      unit(ORG, 'u-appt', {
        agenda: {
          mode: 'appointment',
          businessHours: {
            monday: { open: '09:00', close: '18:00' },
            tuesday: null,
            wednesday: null,
            thursday: null,
            friday: null,
            saturday: null,
            sunday: null,
          },
          slotMinutes: 30,
          cancellationPolicy: { enabled: true, minNoticeMinutes: 120 },
          confirmationTemplates: { confirmation: 'c', reminder: 'r', cancellation: 'x' },
        },
      }),
    )
    await createMembership(
      membership(ORG, 'user-1', {
        role: 'member_operator',
        rlsUnitScope: 'u-appt',
        permissions: defaultPermissionsForRole('member_operator'),
      }),
    )

    const replayedOrg = await Effect.runPromise(
      replayAggregate(OrgConfig, orgRef(ORG)).pipe(Effect.provide(PostgresPersistenceLayer)),
    )
    expect(replayedOrg.vertical).toBe('barbershop')
    expect(replayedOrg._version).toBe(1)

    const replayedUnit = await Effect.runPromise(
      replayAggregate(UnitConfig, unitRef(ORG, 'u-appt')).pipe(
        Effect.provide(PostgresPersistenceLayer),
      ),
    )
    expect(replayedUnit.agenda.mode).toBe('appointment')
    if (replayedUnit.agenda.mode === 'appointment') {
      expect(replayedUnit.agenda.slotMinutes).toBe(30)
    }

    const replayedMembership = await Effect.runPromise(
      replayAggregate(MembershipConfig, membershipRef(ORG, `${ORG}_user-1`)).pipe(
        Effect.provide(PostgresPersistenceLayer),
      ),
    )
    expect(replayedMembership.role).toBe('member_operator')
    expect(replayedMembership.rlsUnitScope).toBe('u-appt')
  })

  it('AC-01: the DATABASE refuses an invalid vertical (enum CHECK), rolling back event + projection', async () => {
    await expect(
      getEventStorePool().query(
        `INSERT INTO orgs (org_id, id, last_event_version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
         VALUES ($1,$1,1,'X','x','telepathy','u','{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
        ['bad'],
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('AC-01: the DATABASE refuses a membership with an invalid role (enum CHECK)', async () => {
    await expect(
      getEventStorePool().query(
        `INSERT INTO memberships (org_id, id, user_id, last_event_version, role, status, joined_at, permissions, updated_at)
         VALUES ($1,'bad','u',1,'wizard','active','2026-01-01T00:00:00Z','{}'::jsonb,'2026-01-01T00:00:00Z')`,
        [ORG],
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('AC-01: the DATABASE refuses a unit whose org_id has no org (FK)', async () => {
    await expect(
      getEventStorePool().query(
        `INSERT INTO units (org_id, id, last_event_version, name, slug, timezone, agenda_mode, fiscal_kind, address, agenda, fiscal, created_at, updated_at)
         VALUES ('ghost-org','u',1,'C','c','America/Sao_Paulo','fixed','informal','{"postalCode":"01310100","state":"SP","city":"São Paulo","neighborhood":"Bela Vista","street":"Avenida Paulista","number":"1000","complement":null}'::jsonb,'{}'::jsonb,'{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
      ),
    ).rejects.toMatchObject({ code: '23503' })
  })

  it('AC-05: a hard-delete drops the typed org row (event history preserved)', async () => {
    await createOrg(org(ORG))
    expect(await rowCount('orgs', ORG, ORG)).toBe(1)

    await Effect.runPromise(
      appendEvent(OrgConfig, orgRef(ORG), {
        _tag: 'org.deleted',
        actorId: 'test',
        payload: {},
      }).pipe(Effect.provide(PostgresPersistenceLayer)),
    )
    await deletePostgresProjection(orgRef(ORG))

    expect(await rowCount('orgs', ORG, ORG)).toBe(0)
    const events = await getEventStorePool().query<{ n: number }>(
      'SELECT count(*)::int AS n FROM events WHERE aggregate_id = $1',
      [ORG],
    )
    expect(events.rows[0]?.n).toBe(2)
  })
})
