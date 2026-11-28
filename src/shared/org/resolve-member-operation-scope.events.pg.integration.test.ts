import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { defaultPermissionsForRole, type Membership, type Role } from '@/domain'
import { closeEventStoreDb } from '@/shared/db/pg/pool'
import { ownerPool } from '@/shared/db/pg/test/owner-pool'
import {
  NO_MEMBER_OPERATION_SCOPE,
  resolveMemberOperationScope,
} from '@/shared/org/member-operation-read'

const ORG = 'org-scope'
let seq = 0
function uid(): string {
  seq += 1
  return `scope-user-${seq}`
}

function pool() {
  return ownerPool()
}

async function seedOrg(): Promise<void> {
  await pool().query(
    `INSERT INTO orgs (org_id, id, last_event_version, name, slug, vertical, owner_user_id, branding, created_at, updated_at)
     VALUES ($1,$1,1,'Org','slug-'||$1,'barbershop','owner','{}'::jsonb,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
     ON CONFLICT (org_id) DO NOTHING`,
    [ORG],
  )
}

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
    const scope = await resolveMemberOperationScope(membership('member_operator', uid()))
    expect(scope).toBe(NO_MEMBER_OPERATION_SCOPE)
  })

  it('keys on CAPABILITY, not the role label (#1269): canManageCustomers widens to balcão', async () => {
    const userId = uid()
    await seedMemberOperationRow(userId)
    const scope = await resolveMemberOperationScope(membership('member_operator', userId, true))
    expect(scope).toBe('')
  })

  it('keys on CAPABILITY, not the role label (#1269): a member WITHOUT canManageCustomers is clamped own-scope', async () => {
    const userId = uid()
    const moId = await seedMemberOperationRow(userId)
    const scope = await resolveMemberOperationScope(membership('member_operator', userId, false))
    expect(scope).toBe(moId)
  })
})
