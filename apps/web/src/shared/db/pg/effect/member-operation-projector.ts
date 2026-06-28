import { MemberOperationConfig } from '@/domain/aggregates/member-operation/config'
import type { AggregateRef, FirestoreDoc } from '@/domain/effect'
import { StoredMemberOperation } from '@/domain/types/member-operation'
import { membershipDocId } from '@/domain/types/membership'
import { Schema } from 'effect'
import type { PoolClient } from 'pg'
import { registerTypedProjector, type TypedProjector } from './typed-projections'

/**
 * Typed projector for the `memberOperation` context (brief 0060, Grupo A) — plugged
 * into the per-context typed-projection registry without reopening the
 * `PersistencePort`.
 *
 * `upsert` decodes the reduced `state` against the domain `StoredMemberOperation`
 * schema (the PII-omitted shape — name/whatsapp/email live on the global User,
 * `taxIdentity` in `member_operations_pii`). It maps `user_id` onto a constrained
 * column and the composite fields (default_commission, unit_ids,
 * catalog_service_ids) onto JSONB. The DB enforces the invariants — a violation
 * rolls back event + projection together. `operational_status` is NOT stored
 * (brief 0068 D4 / #1226 AC-02 — derived on read).
 */

const decodeMemberOperation = Schema.decodeUnknownSync(StoredMemberOperation)

/**
 * The ordered `memberOperations` column list — single source of truth for the
 * runtime upsert and the E2E seed (so the two writers can never drift). Mirrors
 * the `INSERT` placeholders 1:1.
 */
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
    // `member_id` is derived deterministically from the membership key
    // (`{orgId}_{userId}`) — it does NOT enter the event payload (brief 0076
    // AC-02). The composite FK `(org_id, member_id) → memberships(org_id, id)`
    // hangs the operational profile off the membership; both the membership and
    // the memberOperation events commit in the SAME ACID tx (invite-accept saga),
    // so the membership row exists when this projection inserts.
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

// ── Derived join tables (brief 0068 D3): memberOperation ↔ unit / service ─────────
// The N:N arrays (`unit_ids`/`catalog_service_ids`) stay in the reduced state
// (reducer untouched); the projector mirrors them into relational rows in the
// SAME tx (the `org-projector` public-directory pattern). Delete-then-insert
// keeps replay/edit idempotent — a shrunk array leaves no orphan rows. The SQL +
// value-builders are exported so any seed writing `member_operations` directly stays
// in lockstep and never drifts.
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
  // Mirror the N:N arrays into the join tables (same tx). Delete-then-insert so a
  // shrunk array leaves no orphans and replay is idempotent.
  await client.query(MEMBER_OPERATION_UNITS_DELETE, [memberOperation.orgId, memberOperation.id])
  for (const row of memberOperationUnitRows(memberOperation)) {
    await client.query(MEMBER_OPERATION_UNITS_INSERT, row)
  }
  await client.query(MEMBER_OPERATION_SERVICES_DELETE, [memberOperation.orgId, memberOperation.id])
  for (const row of memberOperationServiceRows(memberOperation)) {
    await client.query(MEMBER_OPERATION_SERVICES_INSERT, row)
  }
}

// Row shape the typed table stores; mapped back to the reducer's doc on read.
export type MemberOperationRow = {
  org_id: string
  id: string
  last_event_version: string | number
  user_id: string
  // Membership key (`{org_id}_{user_id}`) — derived in the projector, backed by
  // the composite FK to `memberships`. Not surfaced on the domain doc (it's
  // derivable from userId), so `rowToDoc` omits it.
  member_id: string
  default_commission: unknown
  unit_ids: unknown
  catalog_service_ids: unknown
  created_at: string
  updated_at: string
}

// Reconstructs the reducer's projected doc from the typed row (inverse of
// `upsert`). `_version` is re-attached so the event store versions/replays
// correctly. PII is NOT present (the read path merges it from the sidecars).
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
  // Drop the join rows explicitly (the parent FK is ON DELETE cascade, so this is
  // defensive + mirrors `org-projector`'s directory cleanup). The ref carries the
  // org + id directly.
  await client.query(MEMBER_OPERATION_UNITS_DELETE, [ref.orgId, ref.id])
  await client.query(MEMBER_OPERATION_SERVICES_DELETE, [ref.orgId, ref.id])
  await client.query('DELETE FROM member_operations WHERE org_id = $1 AND id = $2', [
    ref.orgId,
    ref.id,
  ])
}

export const memberOperationProjector: TypedProjector = { read, upsert, delete: remove }

/**
 * `aggregate_type` for memberOperations = the typed `AggregateType` literal
 * (`config.type`, singular `memberOperation`) — D6 (ADR 0013). The Postgres Layer
 * routes by the ref's `type`, so registration and routing agree on this literal.
 */
export const MEMBER_OPERATION_AGGREGATE_TYPE = MemberOperationConfig.type

registerTypedProjector(MEMBER_OPERATION_AGGREGATE_TYPE, memberOperationProjector)
