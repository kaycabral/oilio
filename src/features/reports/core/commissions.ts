import {
  type Commission,
  type CommissionReportSummary,
  type CoveredAttendanceSummary,
  type LiquidationStatus,
  type MemberCommissionSummary,
  type Order,
  liquidationStatusOf,
  summarizeCommissions,
  summarizeCommissionsByMember,
  summarizeCoveredAttendances,
} from '@/domain'

export type CommissionsMember = { userId: string; name: string }

export type CommissionsSectionData = {
  commissions: Commission[]
  summary: CommissionReportSummary
  byMember: MemberCommissionSummary[]
  coveredByMember: CoveredAttendanceSummary[]
  members: CommissionsMember[]
  memberNameByUserId: Record<string, string>
  memberFilter: string | null
  statusFilter: LiquidationStatus | null
}

export type ShapeCommissionsInput = {
  members: CommissionsMember[]
  allCommissions: Commission[]
  allClosedOrders: Order[]
  unitId: string | null
  memberFilter: string | null
  statusFilter: LiquidationStatus | null
}

export function shapeCommissionsSection(input: ShapeCommissionsInput): CommissionsSectionData {
  const { members, allCommissions, allClosedOrders, unitId, memberFilter, statusFilter } = input

  const orderUnitById = new Map(allClosedOrders.map((o) => [o.id, o.unitId]))
  const unitScopedClosedOrders = allClosedOrders.filter((o) => o.unitId === unitId)

  const unitScopedCommissions = allCommissions.filter(
    (c) => orderUnitById.get(c.orderId) === unitId,
  )

  const scopedCommissions = memberFilter
    ? unitScopedCommissions.filter((c) => c.attributedUserId === memberFilter)
    : unitScopedCommissions
  const commissions = statusFilter
    ? scopedCommissions.filter((c) => liquidationStatusOf(c) === statusFilter)
    : scopedCommissions

  const coveredReport = summarizeCoveredAttendances(unitScopedClosedOrders)
  const coveredByMember = memberFilter
    ? coveredReport.byMemberOperation.filter((r) => r.memberOperationId === memberFilter)
    : coveredReport.byMemberOperation

  const summary = summarizeCommissions(scopedCommissions)
  const byMember = summarizeCommissionsByMember(scopedCommissions)
  const memberNameByUserId: Record<string, string> = Object.fromEntries(
    members.map((m) => [m.userId, m.name]),
  )
  for (const c of unitScopedCommissions) {
    if (c.attributedMemberName) memberNameByUserId[c.attributedUserId] = c.attributedMemberName
  }

  return {
    commissions,
    summary,
    byMember,
    coveredByMember,
    members: members.map((m) => ({ userId: m.userId, name: m.name })),
    memberNameByUserId,
    memberFilter,
    statusFilter,
  }
}
