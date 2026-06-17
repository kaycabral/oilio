import { CashMovement, type CashMovementTotals, StoredUnit, computeMovementTotals } from '@/domain'
import type { CashReportRange } from '@/features/cash/core/range'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import 'server-only'

// Props the Vendas section (`<SalesReport>`) consumes. Migrated from the former
// `/cash/report` query (brief 0031 AC-05): the same tenant-timezone period
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
 * tenant-timezone "dois relógios" range (brief 0015); the data is scoped to the
 * active unit (brief 0044). `unitId` is null only for a tenant with no units
 * (then there are no movements anyway). Only sale/sale_reversal movements exist
 * post-0031 (manual drawer ops removed), so the totals are sales by payment
 * method.
 */
export async function loadSalesSectionData(args: {
  tenantId: string
  range: CashReportRange
  unitId: string | null
}): Promise<SalesSectionData> {
  const { tenantId, range, unitId } = args
  const tenantRef = getAdminFirestore().collection('tenants').doc(tenantId)

  const [unitsSnap, movementsSnap] = await Promise.all([
    tenantRef.collection('units').withConverter(fsConverter(StoredUnit)).orderBy('name').get(),
    tenantRef
      .collection('cash_movements')
      .withConverter(fsConverter(CashMovement))
      .where('createdAt', '>=', range.fromIso)
      .where('createdAt', '<=', range.toIso)
      .orderBy('createdAt', 'asc')
      .get(),
  ])

  const units = unitsSnap.docs.map((d) => d.data())
  const allMovements = movementsSnap.docs.map((d) => d.data())
  const movements = allMovements.filter((m) => m.unitId === unitId)

  const totals = computeMovementTotals(movements)
  const unitNameById: Record<string, string> = Object.fromEntries(units.map((u) => [u.id, u.name]))

  return { movements, totals, unitNameById }
}
