import { CashMovement, type CashMovementTotals, computeMovementTotals } from '@/domain'
import type { CashReportRange } from '@/features/cash/core/range'
import {
  type CashMovementRow,
  rowToDoc as cashMovementRowToDoc,
} from '@/shared/db/pg/effect/cash-movement-projector'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { listUnitsForOrg } from '@/shared/org/unit-read'
import { Schema } from 'effect'
import 'server-only'

const decodeCashMovement = Schema.decodeUnknownSync(CashMovement)

async function loadMovementsInWindow(
  orgId: string,
  range: CashReportRange,
): Promise<CashMovement[]> {
  const rows = await readUnderRls<CashMovementRow>(orgId, (client) =>
    client
      .query<CashMovementRow>(
        `SELECT * FROM cash_movements
           WHERE org_id = $1 AND created_at >= $2 AND created_at <= $3
           ORDER BY created_at ASC`,
        [orgId, range.fromIso, range.toIso],
      )
      .then((res) => res.rows),
  )
  return rows.map((r) => decodeCashMovement(cashMovementRowToDoc(r)))
}

export type SalesSectionData = {
  movements: CashMovement[]
  totals: CashMovementTotals
  unitNameById: Record<string, string>
}

export async function loadSalesSectionData(args: {
  orgId: string
  range: CashReportRange
  unitId: string | null
}): Promise<SalesSectionData> {
  const { orgId, range, unitId } = args

  const [units, allMovements] = await Promise.all([
    listUnitsForOrg(orgId),
    loadMovementsInWindow(orgId, range),
  ])

  const movements = allMovements.filter((m) => m.unitId === unitId)

  const totals = computeMovementTotals(movements)
  const unitNameById: Record<string, string> = Object.fromEntries(units.map((u) => [u.id, u.name]))

  return { movements, totals, unitNameById }
}
