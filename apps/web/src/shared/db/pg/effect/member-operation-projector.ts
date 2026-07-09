import { MemberOperationConfig } from '@/domain/aggregates/member-operation/config'
import type { AggregateRef, FirestoreDoc } from '@/domain/effect'
import { StoredMemberOperation } from '@/domain/types/member-operation'
import { membershipDocId } from '@/domain/types/membership'
import { Schema } from 'effect'
import type { PoolClient } from 'pg'
import { registerTypedProjector, type TypedProjector } from './typed-projections'

const decodeMemberOperation = Schema.decodeUnknownSync(StoredMemberOperation)

export const MEMBER_OPERATION_COLUMNS = [
  'org_id',
  'id',
  'last_event_version',
  'user_id',
  'member_id',
  'default_commission',
  'unit_ids',
  'catalog_service_ids',
  'created_at',
  'updated_at',
] as const

export function memberOperationColumnValues(
  memberOperation: StoredMemberOperation,
  lastEventVersion: number,
): unknown[] {
  return [
    memberOperation.orgId,
    memberOperation.id,
    lastEventVersion,
    memberOperation.userId,
    membershipDocId(memberOperation.orgId, memberOperation.userId),
    memberOperation.defaultCommission,
    JSON.stringify(memberOperation.unitIds),
    JSON.stringify(memberOperation.catalogServiceIds),
    memberOperation.createdAt,
    memberOperation.updatedAt,
  ]
}

const PLACEHOLDERS = MEMBER_OPERATION_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')
const CONFLICT_SET = MEMBER_OPERATION_COLUMNS.filter((c) => c !== 'org_id' && c !== 'id')
  .map((c) => `${c} = EXCLUDED.${c}`)
  .join(', ')
const UPSERT = `
  INSERT INTO member_operations (${MEMBER_OPERATION_COLUMNS.join(', ')})
  VALUES (${PLACEHOLDERS})
  ON CONFLICT (org_id, id) DO UPDATE SET ${CONFLICT_SET}
`

export const MEMBER_OPERATION_UNITS_DELETE =
  'DELETE FROM member_operation_units WHERE org_id = $1 AND member_operation_id = $2'
export const MEMBER_OPERATION_UNITS_INSERT =
  'INSERT INTO member_operation_units (org_id, member_operation_id, unit_id) VALUES ($1, $2, $3)'
export const MEMBER_OPERATION_SERVICES_DELETE =
  'DELETE FROM member_operation_services WHERE org_id = $1 AND member_operation_id = $2'
export const MEMBER_OPERATION_SERVICES_INSERT =
  'INSERT INTO member_operation_services (org_id, member_operation_id, service_id) VALUES ($1, $2, $3)'

export function memberOperationUnitRows(memberOperation: StoredMemberOperation): unknown[][] {
  return memberOperation.unitIds.map((unitId) => [
    memberOperation.orgId,
    memberOperation.id,
    unitId,
  ])
}

export function memberOperationServiceRows(memberOperation: StoredMemberOperation): unknown[][] {
  return memberOperation.catalogServiceIds.map((serviceId) => [
    memberOperation.orgId,
    memberOperation.id,
    serviceId,
  ])
}

function stateVersion(state: FirestoreDoc): number {
  const v = state['_version']
  return typeof v === 'number' ? v : 0
}

async function upsert(client: PoolClient, _ref: AggregateRef, state: FirestoreDoc): Promise<void> {
  const memberOperation = decodeMemberOperation(state)
  await client.query(UPSERT, memberOperationColumnValues(memberOperation, stateVersion(state)))
  await client.query(MEMBER_OPERATION_UNITS_DELETE, [memberOperation.orgId, memberOperation.id])
  for (const row of memberOperationUnitRows(memberOperation)) {
    await client.query(MEMBER_OPERATION_UNITS_INSERT, row)
  }
  await client.query(MEMBER_OPERATION_SERVICES_DELETE, [memberOperation.orgId, memberOperation.id])
  for (const row of memberOperationServiceRows(memberOperation)) {
    await client.query(MEMBER_OPERATION_SERVICES_INSERT, row)
  }
}

export type MemberOperationRow = {
  org_id: string
  id: string
  last_event_version: string | number
  user_id: string
  member_id: string
  default_commission: unknown
  unit_ids: unknown
  catalog_service_ids: unknown
  created_at: string
  updated_at: string
}

export function rowToDoc(row: MemberOperationRow): FirestoreDoc {
  return {
    _version: Number(row.last_event_version),
    id: row.id,
    orgId: row.org_id,
    userId: row.user_id,
    defaultCommission: row.default_commission,
    unitIds: row.unit_ids,
    catalogServiceIds: row.catalog_service_ids,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}

async function read(client: PoolClient, ref: AggregateRef): Promise<FirestoreDoc | null> {
  const res = await client.query<MemberOperationRow>(
    'SELECT * FROM member_operations WHERE org_id = $1 AND id = $2',
    [ref.orgId, ref.id],
  )
  const row = res.rows[0]
  return row ? rowToDoc(row) : null
}

async function remove(client: PoolClient, ref: AggregateRef): Promise<void> {
  await client.query(MEMBER_OPERATION_UNITS_DELETE, [ref.orgId, ref.id])
  await client.query(MEMBER_OPERATION_SERVICES_DELETE, [ref.orgId, ref.id])
  await client.query('DELETE FROM member_operations WHERE org_id = $1 AND id = $2', [
    ref.orgId,
    ref.id,
  ])
}

export const memberOperationProjector: TypedProjector = { read, upsert, delete: remove }

export const MEMBER_OPERATION_AGGREGATE_TYPE = MemberOperationConfig.type

registerTypedProjector(MEMBER_OPERATION_AGGREGATE_TYPE, memberOperationProjector)
