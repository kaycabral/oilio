import type { DashboardPageProps } from '@/features/dashboard/adapters/load-dashboard'
import { DashboardFilters } from './DashboardFilters'
import { KpiCard, deltaPctFor, formatCents, formatCount, formatPercent } from './KpiCard'
import { PendenciesPanel } from './PendenciesPanel'
import { TrendChart } from './TrendChart'

export function DashboardView({
  filters,
  kpis,
  trendPoints,
  pendencies,
  unitsById,
  customersById,
}: DashboardPageProps) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <div className="flex flex-wrap items-end gap-4">
          <DashboardFilters
            selectedPeriod={filters.period}
            fromDate={filters.fromDate}
            toDate={filters.toDate}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          label="MRR"
          formattedValue={formatCents(kpis.mrrCents.value)}
          previousFormatted={null}
        />
        <KpiCard
          label="ARR"
          formattedValue={formatCents(kpis.arrCents.value)}
          previousFormatted={null}
        />
        <KpiCard
          label="Assinantes ativos"
          formattedValue={formatCount(kpis.activeSubscribers.value)}
          previousFormatted={null}
        />
        <KpiCard
          label="Faturamento"
          formattedValue={formatCents(kpis.revenueCents.value)}
          previousFormatted={
            kpis.revenueCents.previousValue !== null
              ? formatCents(kpis.revenueCents.previousValue)
              : null
          }
          deltaPct={deltaPctFor(kpis.revenueCents.value, kpis.revenueCents.previousValue)}
        />
        <KpiCard
          label="Ocupação"
          formattedValue={formatPercent(kpis.occupancyPct.value)}
          previousFormatted={
            kpis.occupancyPct.previousValue !== null
              ? formatPercent(kpis.occupancyPct.previousValue)
              : null
          }
          deltaPct={deltaPctFor(kpis.occupancyPct.value, kpis.occupancyPct.previousValue)}
        />
        <KpiCard
          label="Ticket médio"
          formattedValue={formatCents(kpis.averageTicketCents.value)}
          previousFormatted={
            kpis.averageTicketCents.previousValue !== null
              ? formatCents(kpis.averageTicketCents.previousValue)
              : null
          }
          deltaPct={deltaPctFor(
            kpis.averageTicketCents.value,
            kpis.averageTicketCents.previousValue,
          )}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <TrendChart points={trendPoints} />
        </div>
        <PendenciesPanel
          pendencies={pendencies}
          unitsById={unitsById}
          customersById={customersById}
        />
      </div>
    </div>
  )
}
