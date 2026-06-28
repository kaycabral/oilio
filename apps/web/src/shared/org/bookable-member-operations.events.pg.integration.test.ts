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

/**
 * The read-path invariant for the agenda against REAL Postgres:
 * `listBookableMemberOperationsForOrg` returns ONLY memberOperations that are BOTH
 * operational AND backed by a CURRENTLY active membership carrying the
 * `canBeBooked` capability (brief 0076 AC-03 — the retired `BookableProfessional`
 * brand's role-based filter generalized to the capability). The `memberOperations`
 * projection and the capability can diverge — a row can outlive a toggle — so the
 * agenda read cross-checks the projection against the bookable-member set. This
 * fence proves the cross-check in BOTH directions (demotion/toggle-off drops,
 * promotion/toggle-on re-includes), keyed on current state — never history — and
 * the generalization (a non-memberOperation with `canBeBooked` on appears).
 */

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
     VALUES ($1,$2,1,'Unit','unit-'||$2,'America/Sao_Paulo','always_open','informal','{}'::jsonb,'{}'::jsonb,'{}'::jsonb,$3,$3)
     ON CONFLICT (org_id, id) DO NOTHING`,
    [orgId, id, TS],
  )
}

async function seedService(orgId: string, id: string): Promise<void> {
  await pool().query(
    `INSERT INTO catalog_items (org_id, id, last_event_version, kind, name, category_id, price_cents, price_visibility, active, archived_at, duration_minutes, sku, stock, gtin14, reconciliation_pending, reconciliation_last_attempt, commission, unit_ids, unit_overrides, required_resources, public_visible, created_at, updated_at)
     VALUES ($1,$2,1,'service','Service',NULL,5000,'visible',true,NULL,30,NULL,NULL,NULL,NULL,NULL,NULL,'[]'::jsonb,NULL,NULL,false,$3,$3)
     ON CONFLICT (org_id, id) DO NOTHING`,
    [orgId, id, TS],
  )
}

// Mint a membership for `userId` with the given role through the real write path.
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

// Change a member's role through the real write path (the projector overwrites
// the membership projection in the same tx). Models promotion/demotion — and
// mirrors production (`team.actions.ts`), which re-derives the capability set
// from the new role in the SAME event, so `canBeBooked` flips with the role
// (brief 0076: bookable is the capability, not the role label).
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

// Mint a memberOperation projection through the real write path, plus the linked
// global user. `operational` ⇒ user WITH whatsapp + ≥1 unit + ≥1 service;
// `incomplete` ⇒ user WITHOUT whatsapp. Returns the memberOperation id.
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
    // Membership says receptionist, but a memberOperation row exists for her — a
    // seed/migration leak. The row alone must NOT make her bookable.
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
    // Created as a memberOperation, operational, then demoted to receptionist. The
    // projection row is intentionally kept (role-edit-lifecycle), but she must
    // drop off the agenda the moment the role changes.
    await seedMembership(t, userId, 'member_operator')
    await seedMemberOperationRow(t, userId, { operational: true })
    expect((await listBookableMemberOperationsForOrg(t)).length).toBe(1)
    await changeRole(t, userId, 'receptionist')
    expect(await listBookableMemberOperationsForOrg(t)).toEqual([])
  })

  it('RE-INCLUDES a member promoted back to memberOperation (current state, not history)', async () => {
    const t = uniqueOrg()
    const userId = uid('user')
    // The memberOperation row already exists (kept from a prior stint); promoting
    // the membership back to memberOperation re-includes her with no special-casing
    // — the criterion is the CURRENT role, never history.
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
    // Revoke the membership status directly — the read must drop her even though
    // the role is still `memberOperation` and the projection row remains.
    await pool().query(
      "UPDATE memberships SET status = 'revoked' WHERE org_id = $1 AND user_id = $2",
      [t, userId],
    )
    expect(await listBookableMemberOperationsForOrg(t)).toEqual([])
  })

  it('INCLUDES a non-memberOperation member with canBeBooked toggled on (generalization)', async () => {
    const t = uniqueOrg()
    const userId = uid('user')
    // A receptionist by role — but the org manually turned `canBeBooked` on
    // (e.g. a front-desk person who also takes a few bookings). Brief 0076 makes
    // "bookable" the capability, not the role: with the capability on AND a ready
    // operational profile, they appear on the agenda. This is exactly what the
    // retired `BookableProfessional` role-based brand could NOT express.
    await seedMembership(t, userId, 'receptionist')
    const proId = await seedMemberOperationRow(t, userId, { operational: true })
    // Role-based logic excluded them; capability-based logic does too — UNTIL the
    // capability is toggled on.
    expect(await listBookableMemberOperationsForOrg(t)).toEqual([])
    await pool().query(
      `UPDATE memberships SET permissions = jsonb_set(permissions, '{canBeBooked}', 'true')
       WHERE org_id = $1 AND user_id = $2`,
      [t, userId],
    )
    expect((await listBookableMemberOperationsForOrg(t)).map((p) => p.id)).toEqual([proId])
  })
})
