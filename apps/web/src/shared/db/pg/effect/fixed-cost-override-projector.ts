import type { AggregateRef, FirestoreDoc } from '@/domain/effect'
import { FixedCostOverride } from '@/domain/types/fixed-cost'
import { Schema } from 'effect'
import type { PoolClient } from 'pg'
import { registerTypedProjector, type TypedProjector } from './typed-projections'

const decodeOverride = Schema.decodeUnknownSync(FixedCostOverride)

export const FIXED_COST_OVERRIDE_COLUMNS = [
  'org_id',
  'id',
  'unit_id',
  'series_id',
  'last_event_version',
  'month',
  'amount_cents',
  'created_at',
  'updated_at',
] as const

export function fixedCostOverrideColumnValues(
  override: FixedCostOverride,
  version: number,
): unknown[] {
  return [
    override.orgId,
    override.id,
    override.unitId,
    override.seriesId,
    version,
    override.month,
    override.amountCents,
    override.createdAt,
    override.updatedAt,
  ]
}

const PLACEHOLDERS = FIXED_COST_OVERRIDE_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')
const CONFLICT_SET = FIXED_COST_OVERRIDE_COLUMNS.filter((c) => c !== 'org_id' && c !== 'id')
  .map((c) => `${c} = EXCLUDED.${c}`)
  .join(', ')
const UPSERT = `
  INSERT INTO fixed_cost_overrides (${FIXED_COST_OVERRIDE_COLUMNS.join(', ')})
  VALUES (${PLACEHOLDERS})
  ON CONFLICT (org_id, id) DO UPDATE SET ${CONFLICT_SET}
`

function stateVersion(state: FirestoreDoc): number {
  const v = state['_version']
  return typeof v === 'number' ? v : 0
}

async function upsert(client: PoolClient, _ref: AggregateRef, state: FirestoreDoc): Promise<void> {
  const override = decodeOverride(state)
  await client.query(UPSERT, fixedCostOverrideColumnValues(override, stateVersion(state)))
}

export type FixedCostOverrideRow = {
  org_id: string
  id: string
  unit_id: string
  series_id: string
  last_event_version: string | number
  month: string
  amount_cents: string | number
  created_at: string
  updated_at: string
}

export function rowToDoc(row: FixedCostOverrideRow): FirestoreDoc {
  return {
    _version: Number(row.last_event_version),
    id: row.id,
    orgId: row.org_id,
    unitId: row.unit_id,
    seriesId: row.series_id,
    month: row.month,
    amountCents: Number(row.amount_cents),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}

async function read(client: PoolClient, ref: AggregateRef): Promise<FirestoreDoc | null> {
  const res = await client.query<FixedCostOverrideRow>(
    'SELECT * FROM fixed_cost_overrides WHERE org_id = $1 AND id = $2',
    [ref.orgId, ref.id],
  )
  const row = res.rows[0]
  return row ? rowToDoc(row) : null
}

async function remove(client: PoolClient, ref: AggregateRef): Promise<void> {
  await client.query('DELETE FROM fixed_cost_overrides WHERE org_id = $1 AND id = $2', [
    ref.orgId,
    ref.id,
  ])
}

export const fixedCostOverrideProjector: TypedProjector = { read, upsert, delete: remove }

export const FIXED_COST_OVERRIDE_AGGREGATE_TYPE = 'fixed_cost_override'

registerTypedProjector(FIXED_COST_OVERRIDE_AGGREGATE_TYPE, fixedCostOverrideProjector)
