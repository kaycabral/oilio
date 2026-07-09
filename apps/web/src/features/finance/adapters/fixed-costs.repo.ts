import 'server-only'

import { FixedCost, FixedCostOverride } from '@/domain'
import {
  rowToDoc as overrideRowToDoc,
  type FixedCostOverrideRow,
} from '@/shared/db/pg/effect/fixed-cost-override-projector'
import {
  rowToDoc as fixedCostRowToDoc,
  type FixedCostRow,
} from '@/shared/db/pg/effect/fixed-cost-projector'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { Schema } from 'effect'

const decodeFixedCost = Schema.decodeUnknownSync(FixedCost)
const decodeOverride = Schema.decodeUnknownSync(FixedCostOverride)

export async function getFixedCostById(orgId: string, id: string): Promise<FixedCost | null> {
  const rows = await readUnderRls<FixedCostRow>(orgId, (client) =>
    client
      .query<FixedCostRow>('SELECT * FROM fixed_costs WHERE org_id = $1 AND id = $2', [orgId, id])
      .then((res) => res.rows),
  )
  const row = rows[0]
  return row ? decodeFixedCost(fixedCostRowToDoc(row)) : null
}

export async function getFixedCostOverride(
  orgId: string,
  seriesId: string,
  month: string,
): Promise<FixedCostOverride | null> {
  const rows = await readUnderRls<FixedCostOverrideRow>(orgId, (client) =>
    client
      .query<FixedCostOverrideRow>(
        'SELECT * FROM fixed_cost_overrides WHERE org_id = $1 AND series_id = $2 AND month = $3',
        [orgId, seriesId, month],
      )
      .then((res) => res.rows),
  )
  const row = rows[0]
  return row ? decodeOverride(overrideRowToDoc(row)) : null
}

export async function readActiveFixedCosts(orgId: string): Promise<FixedCost[]> {
  const rows = await readUnderRls<FixedCostRow>(orgId, (client) =>
    client
      .query<FixedCostRow>(
        `SELECT * FROM fixed_costs
         WHERE org_id = $1 AND archived_at IS NULL
         ORDER BY unit_id, series_id, effective_from`,
        [orgId],
      )
      .then((res) => res.rows),
  )
  return rows.map((row) => decodeFixedCost(fixedCostRowToDoc(row)))
}

export async function readFixedCostOverrides(orgId: string): Promise<FixedCostOverride[]> {
  const rows = await readUnderRls<FixedCostOverrideRow>(orgId, (client) =>
    client
      .query<FixedCostOverrideRow>('SELECT * FROM fixed_cost_overrides WHERE org_id = $1', [orgId])
      .then((res) => res.rows),
  )
  return rows.map((row) => decodeOverride(overrideRowToDoc(row)))
}

export async function listActiveFixedCostsForUnit(
  orgId: string,
  unitId: string,
): Promise<FixedCost[]> {
  const rows = await readUnderRls<FixedCostRow>(
    orgId,
    (client) =>
      client
        .query<FixedCostRow>(
          `SELECT * FROM fixed_costs
           WHERE org_id = $1 AND unit_id = $2 AND archived_at IS NULL
           ORDER BY name, effective_from`,
          [orgId, unitId],
        )
        .then((res) => res.rows),
    unitId,
  )
  return rows.map((row) => decodeFixedCost(fixedCostRowToDoc(row)))
}
