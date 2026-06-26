import type { FirestoreDoc } from '@/domain/effect'
import { Membership } from '@/domain/types/membership'
import { Schema } from 'effect'
import type { PoolClient } from 'pg'
import { registerTypedProjector, type TypedProjector } from './typed-projections'

/**
 * Typed projector for the `membership` context (brief 0059, AC-01/AC-05) — the
 * user↔org join, plugged into the per-context typed-projection registry without
 * reopening the `PersistencePort`.
 *
 * `upsert` decodes the reduced `state` against the domain `Membership` schema at
 * this single driver boundary (schema-validated, no cast leaks), then maps it
 * onto the `memberships` columns: role/status as enum CHECKs, `rls_unit_scope`
 * as a nullable column (the RLS unit policy filters on it directly),
 * `permissions` as JSONB. The DB enforces the invariants — a violation rolls
 * back event + projection together.
 */

const decodeMembership = Schema.decodeUnknownSync(Membership)

/**
 * The ordered `memberships` column list — the single source of truth for the
 * runtime upsert and the E2E seed. Mirrors the `INSERT` placeholders 1:1.
 */
export const MEMBERSHIP_COLUMNS = [
  'aggregate_path',
  'org_id',
  'id',
  'user_id',
  'version',
  'role',
  'status',
  'rls_unit_scope',
  'invited_by',
  'joined_at',
  'permissions',
  'updated_at',
] as const

/**
 * Map a decoded `Membership` (+ aggregate path and projection version) onto the
 * ordered `memberships` column VALUES — the inverse of `rowToDoc`, shared by the
 * runtime projector and the E2E seed. Order matches `MEMBERSHIP_COLUMNS` exactly.
 */
export function membershipColumnValues(
  membership: Membership,
  aggregatePath: string,
  version: number,
): unknown[] {
  return [
    aggregatePath,
    membership.orgId,
    membership.id,
    membership.userId,
    version,
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
const CONFLICT_SET = MEMBERSHIP_COLUMNS.filter((c) => c !== 'aggregate_path')
  .map((c) => `${c} = EXCLUDED.${c}`)
  .join(', ')
const UPSERT = `
  INSERT INTO memberships (${MEMBERSHIP_COLUMNS.join(', ')})
  VALUES (${PLACEHOLDERS})
  ON CONFLICT (aggregate_path) DO UPDATE SET ${CONFLICT_SET}
`

function stateVersion(state: FirestoreDoc): number {
  const v = state['_version']
  return typeof v === 'number' ? v : 0
}

async function upsert(
  client: PoolClient,
  aggregatePath: string,
  state: FirestoreDoc,
): Promise<void> {
  const membership = decodeMembership(state)
  await client.query(UPSERT, membershipColumnValues(membership, aggregatePath, stateVersion(state)))
}

// Row shape the typed table stores; mapped back to the reducer's doc on read.
export type MembershipRow = {
  org_id: string
  id: string
  user_id: string
  version: string | number
  role: string
  status: string
  rls_unit_scope: string | null
  invited_by: string | null
  joined_at: string
  permissions: unknown
  updated_at: string
}

// Reconstructs the reducer's projected doc from the typed row (inverse of
// `upsert`). `_version` (a `bigint` column) is re-attached coerced to number.
export function rowToDoc(row: MembershipRow): FirestoreDoc {
  return {
    _version: Number(row.version),
    id: row.id,
    orgId: row.org_id,
    userId: row.user_id,
    role: row.role,
    status: row.status,
    invitedBy: row.invited_by,
    joinedAt: new Date(row.joined_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    rlsUnitScope: row.rls_unit_scope,
    permissions: row.permissions,
  }
}

async function read(client: PoolClient, aggregatePath: string): Promise<FirestoreDoc | null> {
  const res = await client.query<MembershipRow>(
    'SELECT * FROM memberships WHERE aggregate_path = $1',
    [aggregatePath],
  )
  const row = res.rows[0]
  return row ? rowToDoc(row) : null
}

async function remove(client: PoolClient, aggregatePath: string): Promise<void> {
  await client.query('DELETE FROM memberships WHERE aggregate_path = $1', [aggregatePath])
}

export const membershipProjector: TypedProjector = { read, upsert, delete: remove }

/**
 * `aggregate_type` for memberships = the aggregate-type segment of the event-store path
 * (`memberships/{orgId}_{userId}` → `memberships`). The Postgres Layer derives the
 * same tag with `aggregateTypeOf`, so registration and routing agree.
 */
export const MEMBERSHIP_AGGREGATE_TYPE = 'memberships'

registerTypedProjector(MEMBERSHIP_AGGREGATE_TYPE, membershipProjector)
