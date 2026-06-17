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

// View-model the Comissões section (`<CommissionReport>`) consumes.
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

/**
 * Pure view-model shaping for the Comissões section. Scopes commissions to the
 * active unit (Commission has no `unitId`: it references the closing `orderId`,
 * so we map orderId→unit via the period's closed orders), then applies
 * member/status filters and resolves display names from the commission snapshot
 * (brief 0041 AC-11) with the live member list as fallback.
 */
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
    ? coveredReport.byProfessional.filter((r) => r.professionalId === memberFilter)
    : coveredReport.byProfessional

  const summary = summarizeCommissions(scopedCommissions)
  const byMember = summarizeCommissionsByMember(scopedCommissions)
  // Display name vem do SNAPSHOT na própria comissão (brief 0041 AC-11), NÃO do
  // join ao vivo em `listTenantMembers` (que filtra `status==active` e dropa o
  // membro revogado/suspenso → "--"). O snapshot é self-contained: profissional
  // revogado (offboarding #1103) ou anonimizado-como-cliente ainda exibe o nome
  // real (retenção de vínculo, art. 16). O join ao vivo entra só como fallback
  // pros membros que ainda não têm comissão (ex.: o dropdown de filtro).
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
