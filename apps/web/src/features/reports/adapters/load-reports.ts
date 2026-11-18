import { type LiquidationStatus, DEFAULT_UNIT_TIMEZONE } from '@/domain'
import { hasCapability } from '@/domain/billing/capabilities'
import { type CashReportRange, resolveCashReportRange } from '@/features/cash/core/range'
import { loadCommissionsSectionData } from '@/features/reports/adapters/commissions.repo'
import { type SalesSectionData, loadSalesSectionData } from '@/features/reports/adapters/sales.repo'
import { type CommissionsSectionData } from '@/features/reports/core/commissions'
import { isAuthConfigured } from '@/shared/auth/config'
import { getSessionUser } from '@/shared/auth/session'
import { resolveActiveUnit } from '@/shared/org/active-unit'
import { getOrgTier } from '@/shared/org/billing-read'
import { getActiveOrgContext } from '@/shared/org/membership'
import { redirect } from 'next/navigation'
import 'server-only'

type SearchParams = Record<string, string | string[] | undefined>

export type ReportsPageProps = {
  range: CashReportRange
  sales: SalesSectionData | null
  commissions: CommissionsSectionData | null
  canMarkPaid: boolean
}

function pickFirst(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

export async function loadReportsPage(params: SearchParams): Promise<ReportsPageProps> {
  if (!isAuthConfigured()) redirect('/')

  const session = await getSessionUser()
  if (!session) redirect('/login')

  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) redirect('/onboarding')

  const role = ctx.membership.role
  if (role !== 'owner' && role !== 'manager') redirect('/agenda')
  const canMarkPaid = role === 'owner'

  const { activeUnitId, units } = await resolveActiveUnit(ctx.membership)

  const tz =
    (activeUnitId ? units.find((u) => u.id === activeUnitId)?.timezone : undefined) ??
    units[0]?.timezone ??
    DEFAULT_UNIT_TIMEZONE
  const range = resolveCashReportRange(
    { period: pickFirst(params.period), from: pickFirst(params.from), to: pickFirst(params.to) },
    tz,
  )

  const memberFilter = pickFirst(params.member) ?? pickFirst(params.memberOperation) ?? null
  const rawStatus = pickFirst(params.status)
  const statusFilter: LiquidationStatus | null =
    rawStatus === 'pendente' || rawStatus === 'pago' ? rawStatus : null

  const tier = await getOrgTier(ctx.membership.orgId)
  const salesUnlocked = hasCapability(tier, 'reports.sales')
  const commissionsUnlocked = hasCapability(tier, 'commissions')

  const [sales, commissions] = await Promise.all([
    salesUnlocked
      ? loadSalesSectionData({ orgId: ctx.membership.orgId, range, unitId: activeUnitId })
      : Promise.resolve(null),
    commissionsUnlocked
      ? loadCommissionsSectionData({
          orgId: ctx.membership.orgId,
          range,
          unitId: activeUnitId,
          memberFilter,
          statusFilter,
        })
      : Promise.resolve(null),
  ])

  return { range, sales, commissions, canMarkPaid }
}
