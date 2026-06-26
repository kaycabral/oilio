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

// All cash movements in the createdAt window (org-wide; the call-site filters by
// active unit afterwards).
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

// Props the Vendas section (`<SalesReport>`) consumes. Migrated from the former
// `/cash/report` query (brief 0031 AC-05): the same org-timezone period
// window, scoped to the active unit (brief 0044) instead of a unit dropdown.
// Sales only — the despesa breakdown is dropped (expenses deferred to the 0031
// parallel branch), so `expense_categories` is no longer read.
export type SalesSectionData = {
  movements: CashMovement[]
  totals: CashMovementTotals
  unitNameById: Record<string, string>
}

/**
 * Loads the Vendas section data for the reports hub. The period window is the
 * org-timezone "dois relógios" range (brief 0015); the data is scoped to the
 * active unit (brief 0044). `unitId` is null only for a org with no units
 * (then there are no movements anyway). Only sale/sale_reversal movements exist
 * post-0031 (manual drawer ops removed), so the totals are sales by payment
 * method.
 */
export async function loadSalesSectionData(args: {
  orgId: string
  range: CashReportRange
  unitId: string | null
}): Promise<SalesSectionData> {
  const { orgId, range, unitId } = args

  const [units, allMovements] = await Promise.all([
    // Units ordered by name (active only) for the unit-name lookup. The section
    // is scoped to the active unit (`m.unitId === unitId`), which can never be
    // archived, so the active-only narrowing vs the former all-units read is
    // inert for the label resolution.
    listUnitsForOrg(orgId),
    loadMovementsInWindow(orgId, range),
  ])

  const movements = allMovements.filter((m) => m.unitId === unitId)

  const totals = computeMovementTotals(movements)
  const unitNameById: Record<string, string> = Object.fromEntries(units.map((u) => [u.id, u.name]))

  return { movements, totals, unitNameById }
}
