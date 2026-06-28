import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { defaultPermissionsForRole, type Membership, type Role } from '@/domain'
import { closeEventStoreDb, getEventStorePool } from '@/shared/db/pg/pool'
import {
  NO_MEMBER_OPERATION_SCOPE,
  resolveMemberOperationScope,
} from '@/shared/org/member-operation-read'

/**
 * `resolveMemberOperationScope` decision proof (brief 0075, #1268/#1269) against
 * REAL Postgres. The scope is the value the agenda read/write path sets as
 * `app.current_member_operation` — so its three branches are load-bearing for
 * authorization:
 *
 *   1. front-desk (owner/manager/recepção, or any member with `canManageCustomers`)
 *      → `''` (the balcão: permissive, sees the whole unit). KEYED ON CAPABILITY,
 *      not the `role` label (#1269): a member whose role isn't literally
 *      `member_operator` but who carries `canManageCustomers` still resolves to the
 *      balcão; a member who lacks it is clamped own-scope even if their role label
 *      were unusual.
 *   2. self-scoped member WITH a `member_operations` projection → their own
 *      `member_operations.id` (own-only).
 *   3. self-scoped member WITHOUT a projection yet (incomplete onboarding /
 *      projection lag) → {@link NO_MEMBER_OPERATION_SCOPE}, the fail-closed
 *      sentinel that matches NO row (never widens to `''`). #1268's empty-state
 *      keys on exactly this value.
 *
 * Seeds over the superuser pool (fixtures exist regardless of RLS); the function
 * reads `member_operations` under RLS internally. OILIO_DATABASE_URL is set by the
 * events-IT runner.
 */

const ORG = 'org-scope'
let seq = 0
function uid(): string {
  seq += 1
  return `scope-user-${seq}`
}

function pool() {
  return getEventStorePool()
}

async function seedOrg(): Promise<void> {
  await pool().query(
    `INSERT INTO orgs (org_id, id, last_event_version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1,$1,1,'Org','slug-'||$1,'barbershop','owner','{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id) DO NOTHING`,
    [ORG],
  )
}

// The `member_operations.member_id` FK (#1260) chains to a `memberships` row
// keyed `org_id||'_'||user_id` — seed the membership first or the insert 23503s.
async function seedMembership(userId: string): Promise<void> {
  await pool().query(
    `INSERT INTO memberships (org_id, id, user_id, last_event_version, role, status, joined_at, permissions, updated_at)
     VALUES ($1,$1||'_'||$2,$2,1,'member_operator','active','2026-01-01T00:00:00Z','{}'::jsonb,'2026-01-01T00:00:00Z')
     ON CONFLICT (org_id, id) DO NOTHING`,
    [ORG, userId],
  )
}

async function seedMemberOperationRow(userId: string): Promise<string> {
  await seedMembership(userId)
  const id = `mo-${userId}`
  await pool().query(
    `INSERT INTO member_operations (org_id, id, last_event_version, user_id, member_id, default_commission, unit_ids, catalog_service_ids, created_at, updated_at)
     VALUES ($1,$2,1,$3,$1||'_'||$3,NULL,'[]'::jsonb,'[]'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id, id) DO NOTHING`,
    [ORG, id, userId],
  )
  return id
}

// Builds a membership with the canonical permission preset for `role`, then
// applies any explicit `canManageCustomers` override — so we can prove the
// capability gate (#1269) independently of the role label.
function membership(role: Role, userId: string, canManageCustomers?: boolean): Membership {
  const permissions = defaultPermissionsForRole(role)
  return {
    orgId: ORG,
    id: `${ORG}_${userId}`,
    userId,
    role,
    status: 'active',
    rlsUnitScope: null,
    invitedBy: null,
    joinedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    permissions:
      canManageCustomers === undefined ? permissions : { ...permissions, canManageCustomers },
  }
}

beforeEach(async () => {
  await seedOrg()
})

afterAll(async () => {
  await closeEventStoreDb()
})

describe('resolveMemberOperationScope (brief 0075, #1268/#1269)', () => {
  it('returns "" (balcão) for owner/manager/receptionist — front-desk by role', async () => {
    expect(await resolveMemberOperationScope(membership('owner', uid()))).toBe('')
    expect(await resolveMemberOperationScope(membership('manager', uid()))).toBe('')
    expect(await resolveMemberOperationScope(membership('receptionist', uid()))).toBe('')
  })

  it('returns the member’s own member_operations.id for a self-scoped member WITH a projection', async () => {
    const userId = uid()
    const moId = await seedMemberOperationRow(userId)
    const scope = await resolveMemberOperationScope(membership('member_operator', userId))
    expect(scope).toBe(moId)
  })

  it('returns the fail-closed sentinel for a self-scoped member WITHOUT a projection', async () => {
    // No member_operations row seeded for this user → onboarding incomplete / lag.
    const scope = await resolveMemberOperationScope(membership('member_operator', uid()))
    expect(scope).toBe(NO_MEMBER_OPERATION_SCOPE)
  })

  it('keys on CAPABILITY, not the role label (#1269): canManageCustomers widens to balcão', async () => {
    // A member_operator-role membership that nonetheless carries canManageCustomers
    // (a custom preset ADR 0014 allows) operates the front desk → balcão scope.
    const userId = uid()
    await seedMemberOperationRow(userId)
    const scope = await resolveMemberOperationScope(membership('member_operator', userId, true))
    expect(scope).toBe('')
  })

  it('keys on CAPABILITY, not the role label (#1269): a member WITHOUT canManageCustomers is clamped own-scope', async () => {
    const userId = uid()
    const moId = await seedMemberOperationRow(userId)
    // Even if the role label were unusual, the absence of canManageCustomers (and
    // not being owner/manager) clamps to own-scope.
    const scope = await resolveMemberOperationScope(membership('member_operator', userId, false))
    expect(scope).toBe(moId)
  })
})
