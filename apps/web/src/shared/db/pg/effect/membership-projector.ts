import type { AggregateRef, StoredDoc } from '@/domain/effect'
import { Role } from '@/domain/types/enums'
import { Membership, withRoleDefaultedPermissions } from '@/domain/types/membership'
import { Schema } from 'effect'
import type { PoolClient } from 'pg'
import { registerTypedProjector, type TypedProjector } from './typed-projections'

const decodeMembership = Schema.decodeUnknownSync(Membership)

export const MEMBERSHIP_COLUMNS = [
  'org_id',
  'id',
  'user_id',
  'last_event_version',
  'role',
  'status',
  'rls_unit_scope',
  'invited_by',
  'joined_at',
  'permissions',
  'updated_at',
] as const

export function membershipColumnValues(
  membership: Membership,
  ref: AggregateRef,
  lastEventVersion: number,
): unknown[] {
  return [
    ref.orgId,
    ref.id,
    membership.userId,
    lastEventVersion,
    membership.role,
    membership.status,
    membership.rlsUnitScope,
    membership.invitedBy,
    membership.joinedAt,
    membership.permissions,
    membership.updatedAt,
  ]
}

const PLACEHOLDERS = MEMBERSHIP_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')
const CONFLICT_SET = MEMBERSHIP_COLUMNS.filter((c) => c !== 'org_id' && c !== 'id')
  .map((c) => `${c} = EXCLUDED.${c}`)
  .join(', ')
const UPSERT = `
  INSERT INTO memberships (${MEMBERSHIP_COLUMNS.join(', ')})
  VALUES (${PLACEHOLDERS})
  ON CONFLICT (org_id, id) DO UPDATE SET ${CONFLICT_SET}
`

function stateVersion(state: StoredDoc): number {
  const v = state['_version']
  return typeof v === 'number' ? v : 0
}

async function upsert(client: PoolClient, ref: AggregateRef, state: StoredDoc): Promise<void> {
  const membership = decodeMembership(state)
  await client.query(UPSERT, membershipColumnValues(membership, ref, stateVersion(state)))
}

export type MembershipRow = {
  org_id: string
  id: string
  user_id: string
  last_event_version: string | number
  role: string
  status: string
  rls_unit_scope: string | null
  invited_by: string | null
  joined_at: string
  permissions: unknown
  updated_at: string
}

export function rowToDoc(row: MembershipRow): StoredDoc {
  return {
    _version: Number(row.last_event_version),
    id: row.id,
    orgId: row.org_id,
    userId: row.user_id,
    role: row.role,
    status: row.status,
    invitedBy: row.invited_by,
    joinedAt: new Date(row.joined_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    rlsUnitScope: row.rls_unit_scope,
    permissions: withRoleDefaultedPermissions(
      Schema.decodeUnknownSync(Role)(row.role),
      row.permissions,
    ),
  }
}

async function read(client: PoolClient, ref: AggregateRef): Promise<StoredDoc | null> {
  const res = await client.query<MembershipRow>(
    'SELECT * FROM memberships WHERE org_id = $1 AND id = $2',
    [ref.orgId, ref.id],
  )
  const row = res.rows[0]
  return row ? rowToDoc(row) : null
}

async function remove(client: PoolClient, ref: AggregateRef): Promise<void> {
  await client.query('DELETE FROM memberships WHERE org_id = $1 AND id = $2', [ref.orgId, ref.id])
}

export const membershipProjector: TypedProjector = { read, upsert, delete: remove }

export const MEMBERSHIP_AGGREGATE_TYPE = 'membership'

registerTypedProjector(MEMBERSHIP_AGGREGATE_TYPE, membershipProjector)
