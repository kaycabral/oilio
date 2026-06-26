import { MembershipConfig } from '@/domain/aggregates/membership/config'
import { OrgConfig } from '@/domain/aggregates/org/config'
import { aggregateRef, appendEvent } from '@/domain/effect'
import { defaultPermissionsForRole, type Membership } from '@/domain/types/membership'
import { DEFAULT_ORG_BRANDING, type StoredOrg } from '@/domain/types/org'
import { PostgresPersistenceLayer } from '@/shared/db/pg/effect/postgres-layer'
import { closeEventStoreDb, getEventStorePool } from '@/shared/db/pg/pool'
import { getMembership } from '@/shared/org/membership'
import { getOrg } from '@/shared/org/org'
import { Effect } from 'effect'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * IDENTITY reads against real Postgres (brief 0059, AC-04) — the read side of
 * the identity cycle: write through the port (event + typed projection in one
 * tx, under RLS), then read back through the SAME accessor the app uses, getting
 * the identical decoded shape.
 *
 * Scoped to the reads that DON'T enrich from Firestore (`getOrg`,
 * `getMembership`) — `listUnitsForOrg`/`listOrgMembers` merge PII/user names from
 * Firestore sidecars and are proven by the E2E (which runs the emulator). The
 * read path sets `app.current_org` via `readUnderRls`; here the ephemeral
 * Postgres is superuser (bypasses RLS), so this proves the routing + decode
 * round-trip, and `rls-isolation.events.pg.integration.test.ts` proves the
 * policy enforcement with a non-superuser role.
 */

const ORG = 'org-read'

function org(id: string, overrides: Partial<StoredOrg> = {}): StoredOrg {
  return {
    id,
    name: 'Org Read',
    slug: `slug-${id}`,
    vertical: 'auto_wash',
    website: null,
    ownerUserId: 'owner-1',
    branding: { ...DEFAULT_ORG_BRANDING },
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

// A membership with a non-null `rls_unit_scope` carries a FK to `units`
// (D2/0068) — seed the parent unit so `membership.created` projects without
// tripping `memberships_rls_unit_scope_fk`.
async function seedUnit(orgId: string, unitId: string): Promise<void> {
  await getEventStorePool().query(
    `INSERT INTO units (org_id, id, last_event_version, name, slug, timezone, agenda_mode, fiscal_kind, address, agenda, fiscal, created_at, updated_at)
     VALUES ($1,$2,1,'Unit','unit-'||$2,'America/Sao_Paulo','always_open','informal','{}'::jsonb,'{}'::jsonb,'{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id, id) DO NOTHING`,
    [orgId, unitId],
  )
}

const createOrg = (data: StoredOrg) =>
  Effect.runPromise(
    appendEvent(OrgConfig, aggregateRef(OrgConfig, data.id, data.id), {
      _tag: 'org.created',
      actorId: 'test',
      payload: { data },
    }).pipe(Effect.provide(PostgresPersistenceLayer)),
  )

const createMembership = (data: Membership) =>
  Effect.runPromise(
    appendEvent(MembershipConfig, aggregateRef(MembershipConfig, data.orgId, data.id), {
      _tag: 'membership.created',
      actorId: 'test',
      payload: { data },
    }).pipe(Effect.provide(PostgresPersistenceLayer)),
  )

describe('Identity reads — Postgres (brief 0059, AC-04)', () => {
  beforeEach(async () => {
    await getEventStorePool().query(
      'TRUNCATE events, projections, units, memberships, orgs CASCADE',
    )
  })

  afterEach(async () => {
    await getEventStorePool().query(
      'TRUNCATE events, projections, units, memberships, orgs CASCADE',
    )
  })

  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('getOrg reads the org back through the typed projection', async () => {
    await createOrg(org(ORG, { name: 'Lava-Rápido Central', vertical: 'auto_wash' }))

    const found = await getOrg(ORG)
    expect(found).not.toBeNull()
    expect(found?.name).toBe('Lava-Rápido Central')
    expect(found?.vertical).toBe('auto_wash')
    // branding is normalized (the JSONB body round-trips through the projection)
    expect(found?.branding).toEqual(DEFAULT_ORG_BRANDING)
  })

  it('getOrg returns null for an unknown org', async () => {
    expect(await getOrg('nope')).toBeNull()
  })

  it('getMembership reads the membership back with role/permissions/unit scope', async () => {
    await createOrg(org(ORG))
    await seedUnit(ORG, 'unit-x')
    await createMembership(
      membership(ORG, 'user-7', {
        role: 'receptionist',
        rlsUnitScope: 'unit-x',
        permissions: defaultPermissionsForRole('receptionist'),
      }),
    )

    const found = await getMembership(ORG, 'user-7')
    expect(found).not.toBeNull()
    expect(found?.role).toBe('receptionist')
    expect(found?.rlsUnitScope).toBe('unit-x')
    expect(found?.permissions.canCreateAppointment).toBe(true)
    expect(found?.permissions.canViewFinancials).toBe(false)
  })

  it('an update event reprojects; the read reflects the new role', async () => {
    await createOrg(org(ORG))
    await createMembership(membership(ORG, 'user-9'))
    await Effect.runPromise(
      appendEvent(MembershipConfig, aggregateRef(MembershipConfig, ORG, `${ORG}_user-9`), {
        _tag: 'membership.updated',
        actorId: 'test',
        payload: { changes: { role: 'manager' } },
      }).pipe(Effect.provide(PostgresPersistenceLayer)),
    )

    const found = await getMembership(ORG, 'user-9')
    expect(found?.role).toBe('manager')
  })
})
