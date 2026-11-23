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
