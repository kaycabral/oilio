// Commission report aggregation (brief 0022 #998 + #1000). Pure summarization
// of commissions by liquidation status (`pendente`/`pago`) — count + total —
// plus per-memberOperation grouping (#1000, AC-05) and the covered-attendance
// report (#1000, AC-07). Kept here for reuse + unit testing; the page wires the
// Firestore reads, these stay framework-free.

import { type Commission, type LiquidationStatus, liquidationStatusOf } from '../types/commission'
import { coverageOf, type Order } from '../types/order'

export type CommissionStatusSummary = {
  count: number
  totalCents: number
}

export type CommissionReportSummary = {
  byStatus: Record<LiquidationStatus, CommissionStatusSummary>
  totalCents: number
  count: number
}

const EMPTY: () => CommissionStatusSummary = () => ({ count: 0, totalCents: 0 })

export function summarizeCommissions(commissions: readonly Commission[]): CommissionReportSummary {
  const byStatus: Record<LiquidationStatus, CommissionStatusSummary> = {
    pendente: EMPTY(),
    pago: EMPTY(),
  }
  let totalCents = 0
  for (const c of commissions) {
    const status = liquidationStatusOf(c)
    byStatus[status].count += 1
    byStatus[status].totalCents += c.amountCents
    totalCents += c.amountCents
  }
  return { byStatus, totalCents, count: commissions.length }
}

// Per-member rollup (brief 0022 #1000, AC-05; re-keyed by member in brief 0030
// AC-07). For each member (`attributedUserId`) that has at least one commission
// in the period, the pendente/pago breakdown + a combined total. The total
// pendente of a member = sum of their unpaid commissions (a métrica secundária).
// A member who is a memberOperation groups under the same `userId`, so the
// memberOperation's row keeps showing up — grouping by member subsumes the old
// per-memberOperation view.
export type MemberCommissionSummary = {
  attributedUserId: string
} & CommissionReportSummary

export function summarizeCommissionsByMember(
  commissions: readonly Commission[],
): MemberCommissionSummary[] {
  const byMember = new Map<string, Commission[]>()
  for (const c of commissions) {
    const list = byMember.get(c.attributedUserId)
    if (list) list.push(c)
    else byMember.set(c.attributedUserId, [c])
  }
  return [...byMember.entries()].map(([attributedUserId, list]) => ({
    attributedUserId,
    ...summarizeCommissions(list),
  }))
}

// Covered-attendance report (brief 0022 #1000, AC-07 — resolve 0021 § AC-09).
// Counts services executed under subscription coverage and sums their catalog
// value, per memberOperation. Covered items do NOT commission (brief 0021 AC-09);
// this is read/count only — the data the owner uses to split the subscription
// fund externally. A covered line = order item with `coverage: subscription`
// AND `kind: service` (only services are covered; products are always a sale).
// The catalog value = snapshot `unitPriceCents * quantity` on the order line.
export type CoveredAttendanceSummary = {
  memberOperationId: string
  count: number
  catalogValueCents: number
}

export type CoveredAttendanceReport = {
  byMemberOperation: CoveredAttendanceSummary[]
  totalCount: number
  totalCatalogValueCents: number
}

export function summarizeCoveredAttendances(orders: readonly Order[]): CoveredAttendanceReport {
  const byMemberOperation = new Map<string, CoveredAttendanceSummary>()
  let totalCount = 0
  let totalCatalogValueCents = 0
  for (const order of orders) {
    for (const item of order.items) {
      // Só serviços cobertos por assinatura entram. Venda (`sale`) e produtos
      // ficam de fora — venda comissionável não é atendimento coberto.
      if (item.kind !== 'service' || coverageOf(item) !== 'subscription') continue
      const valueCents = item.unitPriceCents * item.quantity
      const existing = byMemberOperation.get(item.attributedUserId)
      if (existing) {
        existing.count += 1
        existing.catalogValueCents += valueCents
      } else {
        byMemberOperation.set(item.attributedUserId, {
          memberOperationId: item.attributedUserId,
          count: 1,
          catalogValueCents: valueCents,
        })
      }
      totalCount += 1
      totalCatalogValueCents += valueCents
    }
  }
  return {
    byMemberOperation: [...byMemberOperation.values()],
    totalCount,
    totalCatalogValueCents,
  }
}
