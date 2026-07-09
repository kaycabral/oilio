import { defaultPermissionsForRole, membershipDocId, type Role } from '@/domain'
import { MemberOperationConfig, MembershipConfig } from '@/domain/aggregates'
import { aggregateRef, appendEvent } from '@/domain/effect'
import type { StoredMemberOperation } from '@/domain/types/member-operation'
import { PostgresPersistenceLayer } from '@/shared/db/pg/effect/postgres-layer'
import { closeEventStoreDb, getEventStorePool } from '@/shared/db/pg/pool'
import { putUser } from '@/shared/db/pg/users-store'
import { buildMembership, buildUser } from '@/shared/fixtures/domain-builders'
import { Effect } from 'effect'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { listBookableMemberOperationsForOrg } from './member-operation-read'

const TS = '2026-06-01T12:00:00.000Z'

let seq = 0
function uniqueOrg(): string {
  seq += 1
  return `bookable-${Date.now()}-${seq}`
}
function uid(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now()}-${seq}`
}

function pool() {
  return getEventStorePool()
}

async function seedOrg(orgId: string): Promise<void> {
  await pool().query(
    `INSERT INTO orgs (org_id, id, last_event_version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1,$1,1,'Org','slug-'||$1,'barbershop','owner','{}'::jsonb,$2,$2)
     ON CONFLICT (org_id) DO NOTHING`,
    [orgId, TS],
  )
}

async function seedUnit(orgId: string, id: string): Promise<void> {
  await pool().query(
    `INSERT INTO units (org_id, id, last_event_version, name, slug, timezone, agenda_mode, fiscal_kind, address, agenda, fiscal, created_at, updated_at)
     VALUES ($1,$2,1,'Unit','unit-'||$2,'America/Sao_Paulo','always_open','informal','{"postalCode":"01310100","state":"SP","city":"São Paulo","neighborhood":"Bela Vista","street":"Avenida Paulista","number":"1000","complement":null}'::jsonb,'{}'::jsonb,'{}'::jsonb,$3,$3)
     ON CONFLICT (org_id, id) DO NOTHING`,
    [orgId, id, TS],
  )
}

async function seedService(orgId: string, id: string): Promise<void> {
  await pool().query(
    `INSERT INTO catalog_items (org_id, id, last_event_version, kind, name, category_id, price_cents, price_visibility, active, archived_at, duration_minutes, sku, stock, gtin14, reconciliation_pending, reconciliation_last_attempt, commission, unit_ids, unit_overrides, required_resources, public_visible, created_at, updated_at)
     VALUES ($1,$2,1,'service','Service',NULL,5000,'visible',true,NULL,30,NULL,NULL,NULL,NULL,NULL,NULL,'["unit-seed"]'::jsonb,NULL,NULL,false,$3,$3)
     ON CONFLICT (org_id, id) DO NOTHING`,
    [orgId, id, TS],
  )
}

async function seedMembership(orgId: string, userId: string, role: Role): Promise<void> {
  await seedOrg(orgId)
  await Effect.runPromise(
    appendEvent(
      MembershipConfig,
      aggregateRef(MembershipConfig, orgId, membershipDocId(orgId, userId)),
      {
        _tag: 'membership.created',
        actorId: 'test',
        payload: { data: buildMembership(orgId, userId, TS, { role }) },
      },
    ).pipe(Effect.provide(PostgresPersistenceLayer)),
  )
}

async function changeRole(orgId: string, userId: string, role: Role): Promise<void> {
  await Effect.runPromise(
    appendEvent(
      MembershipConfig,
      aggregateRef(MembershipConfig, orgId, membershipDocId(orgId, userId)),
      {
        _tag: 'membership.updated',
        actorId: 'test',
        payload: { changes: { role, permissions: defaultPermissionsForRole(role) } },
      },
    ).pipe(Effect.provide(PostgresPersistenceLayer)),
  )
}

// global user. `operational` ⇒ user WITH whatsapp + ≥1 unit + ≥1 service;
async function seedMemberOperationRow(
  orgId: string,
  userId: string,
  opts: { operational?: boolean } = {},
): Promise<string> {
  await seedOrg(orgId)
  const operational = opts.operational ?? true
  const unitIds = operational ? [uid('unit')] : []
  const catalogServiceIds = operational ? [uid('svc')] : []
  for (const u of unitIds) await seedUnit(orgId, u)
  for (const s of catalogServiceIds) await seedService(orgId, s)
  await putUser(
    operational ? buildUser(userId, TS, { completionCompleted: true }) : buildUser(userId, TS),
  )
  const id = uid('pro')
  const pro: StoredMemberOperation = {
    id,
    orgId,
    userId,
    defaultCommission: null,
    unitIds,
    catalogServiceIds,
    createdAt: TS,
    updatedAt: TS,
  }
  await Effect.runPromise(
    appendEvent(MemberOperationConfig, aggregateRef(MemberOperationConfig, orgId, id), {
      _tag: 'member_operation.created',
      actorId: 'test',
      payload: { data: pro },
    }).pipe(Effect.provide(PostgresPersistenceLayer)),
  )
  return id
}

const TABLES =
  'events, projections, member_operation_units, member_operation_services, member_operations, memberships, catalog_items, units, orgs, users'

describe('listBookableMemberOperationsForOrg (agenda read-path invariant)', () => {
  beforeEach(async () => {
    await pool().query(`TRUNCATE ${TABLES} CASCADE`)
  })
  afterAll(async () => {
    await closeEventStoreDb()
  })

  it('includes an operational memberOperation with an active memberOperation-role membership', async () => {
    const t = uniqueOrg()
    const userId = uid('user')
    await seedMembership(t, userId, 'member_operator')
    const proId = await seedMemberOperationRow(t, userId, { operational: true })
    const bookable = await listBookableMemberOperationsForOrg(t)
    expect(bookable.map((p) => p.id)).toEqual([proId])
  })

  it('EXCLUDES a receptionist who wrongly carries a memberOperation row (the Paula bug)', async () => {
    const t = uniqueOrg()
    const userId = uid('user')
    await seedMembership(t, userId, 'receptionist')
    await seedMemberOperationRow(t, userId, { operational: true })
    expect(await listBookableMemberOperationsForOrg(t)).toEqual([])
  })

  it('EXCLUDES a memberOperation whose profile is incomplete', async () => {
    const t = uniqueOrg()
    const userId = uid('user')
    await seedMembership(t, userId, 'member_operator')
    await seedMemberOperationRow(t, userId, { operational: false })
    expect(await listBookableMemberOperationsForOrg(t)).toEqual([])
  })

  it('EXCLUDES a demoted member whose memberOperation row lingers (reversibility)', async () => {
    const t = uniqueOrg()
    const userId = uid('user')
    await seedMembership(t, userId, 'member_operator')
    await seedMemberOperationRow(t, userId, { operational: true })
    expect((await listBookableMemberOperationsForOrg(t)).length).toBe(1)
    await changeRole(t, userId, 'receptionist')
    expect(await listBookableMemberOperationsForOrg(t)).toEqual([])
  })

  it('RE-INCLUDES a member promoted back to memberOperation (current state, not history)', async () => {
    const t = uniqueOrg()
    const userId = uid('user')
    await seedMembership(t, userId, 'receptionist')
    const proId = await seedMemberOperationRow(t, userId, { operational: true })
    expect(await listBookableMemberOperationsForOrg(t)).toEqual([])
    await changeRole(t, userId, 'member_operator')
    expect((await listBookableMemberOperationsForOrg(t)).map((p) => p.id)).toEqual([proId])
  })

  it('EXCLUDES a memberOperation whose membership is not active', async () => {
    const t = uniqueOrg()
    const userId = uid('user')
    await seedMembership(t, userId, 'member_operator')
    await seedMemberOperationRow(t, userId, { operational: true })
    await pool().query(
      "UPDATE memberships SET status = 'revoked' WHERE org_id = $1 AND user_id = $2",
      [t, userId],
    )
    expect(await listBookableMemberOperationsForOrg(t)).toEqual([])
  })

  it('INCLUDES a non-memberOperation member with canBeBooked toggled on (generalization)', async () => {
    const t = uniqueOrg()
    const userId = uid('user')
    await seedMembership(t, userId, 'receptionist')
    const proId = await seedMemberOperationRow(t, userId, { operational: true })
    expect(await listBookableMemberOperationsForOrg(t)).toEqual([])
    await pool().query(
      `UPDATE memberships SET permissions = jsonb_set(permissions, '{canBeBooked}', 'true')
       WHERE org_id = $1 AND user_id = $2`,
      [t, userId],
    )
    expect((await listBookableMemberOperationsForOrg(t)).map((p) => p.id)).toEqual([proId])
  })
})
