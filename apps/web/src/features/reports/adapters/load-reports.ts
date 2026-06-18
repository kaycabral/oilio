import { type LiquidationStatus, DEFAULT_ORG_TIMEZONE } from '@/domain'
import { type CashReportRange, resolveCashReportRange } from '@/features/cash/core/range'
import { loadCommissionsSectionData } from '@/features/reports/adapters/commissions.repo'
import { type SalesSectionData, loadSalesSectionData } from '@/features/reports/adapters/sales.repo'
import { type CommissionsSectionData } from '@/features/reports/core/commissions'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { resolveActiveUnit } from '@/shared/org/active-unit'
import { getActiveOrgContext } from '@/shared/org/membership'
import { getOrg } from '@/shared/org/org'
import { redirect } from 'next/navigation'
import 'server-only'

type SearchParams = Record<string, string | string[] | undefined>

export type ReportsPageProps = {
  range: CashReportRange
  sales: SalesSectionData
  commissions: CommissionsSectionData
  canMarkPaid: boolean
}

function pickFirst(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

// Hub de relatórios (brief 0031 AC-05): uma só casca com as seções Vendas
// (período) e Comissões (por membro). Ambas escopam pela unidade ativa do
// contexto (brief 0044) — o agregado cross-unit ("Todas as unidades") foi
// removido. As queries continuam separadas por baixo (Vendas migra de
// `/cash/report`; Comissões reaproveita a lógica de `/reports/commissions`).
export async function loadReportsPage(params: SearchParams): Promise<ReportsPageProps> {
  if (!isFirebaseConfigured()) redirect('/')

  const session = await getSessionUser()
  if (!session) redirect('/login')

  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) redirect('/onboarding')

  const role = ctx.membership.role
  if (role !== 'owner' && role !== 'manager') redirect('/agenda')
  // Marcar pago é gesto de owner (movimenta dinheiro); manager só lê (0022 AC-03).
  const canMarkPaid = role === 'owner'

  // Escopo de unidade (brief 0044): as duas seções leem só a unidade ativa do
  // contexto. `activeUnitId` é null só pra org sem unidade (dados vazios).
  const { activeUnitId } = await resolveActiveUnit(ctx.membership)

  // Janela compartilhada pelas duas seções, por dia de calendário no fuso do
  // org (ADR 0009 / brief 0015 AC-05).
  const org = await getOrg(ctx.membership.orgId)
  const tz = org?.timezone ?? DEFAULT_ORG_TIMEZONE
  const range = resolveCashReportRange(
    { period: pickFirst(params.period), from: pickFirst(params.from), to: pickFirst(params.to) },
    tz,
  )

  // Filtros da seção Comissões (brief 0030 AC-07 / 0022 AC-05). Mantém compat
  // com links antigos que mandavam `?professional=`.
  const memberFilter = pickFirst(params.member) ?? pickFirst(params.professional) ?? null
  const rawStatus = pickFirst(params.status)
  const statusFilter: LiquidationStatus | null =
    rawStatus === 'pendente' || rawStatus === 'pago' ? rawStatus : null

  const [sales, commissions] = await Promise.all([
    loadSalesSectionData({ orgId: ctx.membership.orgId, range, unitId: activeUnitId }),
    loadCommissionsSectionData({
      orgId: ctx.membership.orgId,
      range,
      unitId: activeUnitId,
      memberFilter,
      statusFilter,
    }),
  ])

  return { range, sales, commissions, canMarkPaid }
}
