import type { AggregateRef, FirestoreDoc } from '@/domain/effect'
import { FixedCost } from '@/domain/types/fixed-cost'
import { Schema } from 'effect'
import type { PoolClient } from 'pg'
import { registerTypedProjector, type TypedProjector } from './typed-projections'

const decodeFixedCost = Schema.decodeUnknownSync(FixedCost)

export const FIXED_COST_COLUMNS = [
  'org_id',
  'id',
  'unit_id',
  'series_id',
  'last_event_version',
  'name',
  'category',
  'amount_cents',
  'effective_from',
  'effective_to',
  'archived_at',
  'created_at',
  'updated_at',
] as const

export function fixedCostColumnValues(cost: FixedCost, version: number): unknown[] {
  return [
    cost.orgId,
    cost.id,
    cost.unitId,
    cost.seriesId,
    version,
    cost.name,
    cost.category,
    cost.amountCents,
    cost.effectiveFrom,
    cost.effectiveTo,
    cost.archivedAt,
    cost.createdAt,
    cost.updatedAt,
  ]
}

const PLACEHOLDERS = FIXED_COST_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')
const CONFLICT_SET = FIXED_COST_COLUMNS.filter((c) => c !== 'org_id' && c !== 'id')
  .map((c) => `${c} = EXCLUDED.${c}`)
  .join(', ')
const UPSERT = `
  INSERT INTO fixed_costs (${FIXED_COST_COLUMNS.join(', ')})
  VALUES (${PLACEHOLDERS})
  ON CONFLICT (org_id, id) DO UPDATE SET ${CONFLICT_SET}
`

function stateVersion(state: FirestoreDoc): number {
  const v = state['_version']
  return typeof v === 'number' ? v : 0
}

async function upsert(client: PoolClient, _ref: AggregateRef, state: FirestoreDoc): Promise<void> {
  const cost = decodeFixedCost(state)
  await client.query(UPSERT, fixedCostColumnValues(cost, stateVersion(state)))
}

export type FixedCostRow = {
  org_id: string
  id: string
  unit_id: string
  series_id: string
  last_event_version: string | number
  name: string
  category: 'expense_commercial' | 'expense_admin' | 'expense_financial'
  amount_cents: string | number
  effective_from: string
  effective_to: string | null
  archived_at: string | null
  created_at: string
  updated_at: string
}

export function rowToDoc(row: FixedCostRow): FirestoreDoc {
  return {
    _version: Number(row.last_event_version),
    id: row.id,
    orgId: row.org_id,
    unitId: row.unit_id,
    seriesId: row.series_id,
    name: row.name,
    category: row.category,
    amountCents: Number(row.amount_cents),
    effectiveFrom: new Date(row.effective_from).toISOString(),
    effectiveTo: row.effective_to == null ? null : new Date(row.effective_to).toISOString(),
    archivedAt: row.archived_at == null ? null : new Date(row.archived_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}

async function read(client: PoolClient, ref: AggregateRef): Promise<FirestoreDoc | null> {
  const res = await client.query<FixedCostRow>(
    'SELECT * FROM fixed_costs WHERE org_id = $1 AND id = $2',
    [ref.orgId, ref.id],
  )
  const row = res.rows[0]
  return row ? rowToDoc(row) : null
}

async function remove(client: PoolClient, ref: AggregateRef): Promise<void> {
  await client.query('DELETE FROM fixed_costs WHERE org_id = $1 AND id = $2', [ref.orgId, ref.id])
}

export const fixedCostProjector: TypedProjector = { read, upsert, delete: remove }

export const FIXED_COST_AGGREGATE_TYPE = 'fixed_cost'

registerTypedProjector(FIXED_COST_AGGREGATE_TYPE, fixedCostProjector)
