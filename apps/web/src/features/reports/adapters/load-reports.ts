import { type LiquidationStatus, DEFAULT_UNIT_TIMEZONE } from '@/domain'
import { hasCapability } from '@/domain/billing/capabilities'
import { type CashReportRange, resolveCashReportRange } from '@/features/cash/core/range'
import { loadCommissionsSectionData } from '@/features/reports/adapters/commissions.repo'
import { type SalesSectionData, loadSalesSectionData } from '@/features/reports/adapters/sales.repo'
import { type CommissionsSectionData } from '@/features/reports/core/commissions'
import { getOrgTier } from '@/shared/org/billing-read'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { resolveActiveUnit } from '@/shared/org/active-unit'
import { getActiveOrgContext } from '@/shared/org/membership'
import { redirect } from 'next/navigation'
import 'server-only'

type SearchParams = Record<string, string | string[] | undefined>

export type ReportsPageProps = {
  range: CashReportRange
  // `null` when the active Negócio's tier does not unlock the section — the
  // data is NOT loaded (real gate, brief 0082 AC-01), so nothing to render or
  // export. The UI shows the upgrade CTA in its place.
  sales: SalesSectionData | null
  commissions: CommissionsSectionData | null
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
  const { activeUnitId, units } = await resolveActiveUnit(ctx.membership)

  // Janela compartilhada pelas duas seções, por dia de calendário no fuso do
  // estabelecimento (PRD Identidade v2 — tz movida Org→Unit): usa a unidade
  // ativa; cai na primeira unidade / default pra org sem unidade.
  const tz =
    (activeUnitId ? units.find((u) => u.id === activeUnitId)?.timezone : undefined) ??
    units[0]?.timezone ??
    DEFAULT_UNIT_TIMEZONE
  const range = resolveCashReportRange(
    { period: pickFirst(params.period), from: pickFirst(params.from), to: pickFirst(params.to) },
    tz,
  )

  // Filtros da seção Comissões (brief 0030 AC-07 / 0022 AC-05). Mantém compat
  // com links antigos que mandavam `?memberOperation=`.
  const memberFilter = pickFirst(params.member) ?? pickFirst(params.memberOperation) ?? null
  const rawStatus = pickFirst(params.status)
  const statusFilter: LiquidationStatus | null =
    rawStatus === 'pendente' || rawStatus === 'pago' ? rawStatus : null

  // Tier gate (brief 0082 AC-01): each section is a paid capability. Load a
  // section's data ONLY when the tier unlocks it — a Free org must not receive
  // sales rows or commission rows at all (the CSV export is built client-side
  // from `sales`, so not loading it is what actually closes the leak). The UI
  // renders the upgrade CTA where a `null` section would have been.
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
