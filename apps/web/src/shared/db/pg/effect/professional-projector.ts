import type { FirestoreDoc } from '@/domain/effect'
import { StoredProfessional } from '@/domain/types/professional'
import { Schema } from 'effect'
import type { PoolClient } from 'pg'
import { registerTypedProjector, type TypedProjector } from './typed-projections'

/**
 * Typed projector for the `professional` context (brief 0060, Grupo A) — plugged
 * into the per-context typed-projection registry without reopening the
 * `PersistencePort`.
 *
 * `upsert` decodes the reduced `state` against the domain `StoredProfessional`
 * schema (the PII-omitted shape — name/whatsapp/email live on the global User,
 * `taxIdentity` in `professionals_pii`). It maps `user_id` onto a constrained
 * column and the composite fields (default_commission, unit_ids,
 * catalog_service_ids) onto JSONB. The DB enforces the invariants — a violation
 * rolls back event + projection together. `operational_status` is NOT stored
 * (brief 0068 D4 / #1226 AC-02 — derived on read).
 */

const decodeProfessional = Schema.decodeUnknownSync(StoredProfessional)

/**
 * The ordered `professionals` column list — single source of truth for the
 * runtime upsert and the E2E seed (so the two writers can never drift). Mirrors
 * the `INSERT` placeholders 1:1.
 */
export const PROFESSIONAL_COLUMNS = [
  'aggregate_path',
  'org_id',
  'id',
  'version',
  'user_id',
  'default_commission',
  'unit_ids',
  'catalog_service_ids',
  'created_at',
  'updated_at',
] as const

export function professionalColumnValues(
  professional: StoredProfessional,
  aggregatePath: string,
  version: number,
): unknown[] {
  return [
    aggregatePath,
    professional.orgId,
    professional.id,
    version,
    professional.userId,
    professional.defaultCommission,
    JSON.stringify(professional.unitIds),
    JSON.stringify(professional.catalogServiceIds),
    professional.createdAt,
    professional.updatedAt,
  ]
}

const PLACEHOLDERS = PROFESSIONAL_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')
const CONFLICT_SET = PROFESSIONAL_COLUMNS.filter((c) => c !== 'aggregate_path')
  .map((c) => `${c} = EXCLUDED.${c}`)
  .join(', ')
const UPSERT = `
  INSERT INTO professionals (${PROFESSIONAL_COLUMNS.join(', ')})
  VALUES (${PLACEHOLDERS})
  ON CONFLICT (aggregate_path) DO UPDATE SET ${CONFLICT_SET}
`

// ── Derived join tables (brief 0068 D3): professional ↔ unit / service ─────────
// The N:N arrays (`unit_ids`/`catalog_service_ids`) stay in the reduced state
// (reducer untouched); the projector mirrors them into relational rows in the
// SAME tx (the `org-projector` public-directory pattern). Delete-then-insert
// keeps replay/edit idempotent — a shrunk array leaves no orphan rows. The SQL +
// value-builders are exported so any seed writing `professionals` directly stays
// in lockstep and never drifts.
export const PROFESSIONAL_UNITS_DELETE =
  'DELETE FROM professional_units WHERE org_id = $1 AND professional_id = $2'
export const PROFESSIONAL_UNITS_INSERT =
  'INSERT INTO professional_units (org_id, professional_id, unit_id) VALUES ($1, $2, $3)'
export const PROFESSIONAL_SERVICES_DELETE =
  'DELETE FROM professional_services WHERE org_id = $1 AND professional_id = $2'
export const PROFESSIONAL_SERVICES_INSERT =
  'INSERT INTO professional_services (org_id, professional_id, service_id) VALUES ($1, $2, $3)'

export function professionalUnitRows(professional: StoredProfessional): unknown[][] {
  return professional.unitIds.map((unitId) => [professional.orgId, professional.id, unitId])
}

export function professionalServiceRows(professional: StoredProfessional): unknown[][] {
  return professional.catalogServiceIds.map((serviceId) => [
    professional.orgId,
    professional.id,
    serviceId,
  ])
}

function stateVersion(state: FirestoreDoc): number {
  const v = state['_version']
  return typeof v === 'number' ? v : 0
}

async function upsert(
  client: PoolClient,
  aggregatePath: string,
  state: FirestoreDoc,
): Promise<void> {
  const professional = decodeProfessional(state)
  await client.query(
    UPSERT,
    professionalColumnValues(professional, aggregatePath, stateVersion(state)),
  )
  // Mirror the N:N arrays into the join tables (same tx). Delete-then-insert so a
  // shrunk array leaves no orphans and replay is idempotent.
  await client.query(PROFESSIONAL_UNITS_DELETE, [professional.orgId, professional.id])
  for (const row of professionalUnitRows(professional)) {
    await client.query(PROFESSIONAL_UNITS_INSERT, row)
  }
  await client.query(PROFESSIONAL_SERVICES_DELETE, [professional.orgId, professional.id])
  for (const row of professionalServiceRows(professional)) {
    await client.query(PROFESSIONAL_SERVICES_INSERT, row)
  }
}

// Row shape the typed table stores; mapped back to the reducer's doc on read.
export type ProfessionalRow = {
  org_id: string
  id: string
  version: string | number
  user_id: string
  default_commission: unknown
  unit_ids: unknown
  catalog_service_ids: unknown
  created_at: string
  updated_at: string
}

// Reconstructs the reducer's projected doc from the typed row (inverse of
// `upsert`). `_version` is re-attached so the event store versions/replays
// correctly. PII is NOT present (the read path merges it from the sidecars).
export function rowToDoc(row: ProfessionalRow): FirestoreDoc {
  return {
    _version: Number(row.version),
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

async function read(client: PoolClient, aggregatePath: string): Promise<FirestoreDoc | null> {
  const res = await client.query<ProfessionalRow>(
    'SELECT * FROM professionals WHERE aggregate_path = $1',
    [aggregatePath],
  )
  const row = res.rows[0]
  return row ? rowToDoc(row) : null
}

async function remove(client: PoolClient, aggregatePath: string): Promise<void> {
  // Drop the join rows explicitly (the parent FK is ON DELETE cascade, so this is
  // defensive + mirrors `org-projector`'s directory cleanup). Path is
  // `orgs/{orgId}/professionals/{id}`.
  const parts = aggregatePath.split('/')
  const orgId = parts[1] ?? ''
  const id = parts[3] ?? ''
  await client.query(PROFESSIONAL_UNITS_DELETE, [orgId, id])
  await client.query(PROFESSIONAL_SERVICES_DELETE, [orgId, id])
  await client.query('DELETE FROM professionals WHERE aggregate_path = $1', [aggregatePath])
}

export const professionalProjector: TypedProjector = { read, upsert, delete: remove }

export const PROFESSIONAL_AGGREGATE_TYPE = 'professionals'

registerTypedProjector(PROFESSIONAL_AGGREGATE_TYPE, professionalProjector)
