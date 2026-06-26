import type { ReportsPageProps } from '@/features/reports/adapters/load-reports'
import { CommissionReport } from './CommissionReport'
import { SalesReport } from './SalesReport'

export function ReportsView({ range, sales, commissions, canMarkPaid }: ReportsPageProps) {
  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Relatórios</h1>
          <p className="text-muted-foreground text-sm">
            Desempenho do negócio: vendas por período e comissões por membro.
          </p>
        </div>
      </header>

      <SalesReport
        movements={sales.movements}
        totals={sales.totals}
        unitNameById={sales.unitNameById}
        period={range.period}
        fromDate={range.fromDate}
        toDate={range.toDate}
      />

      <CommissionReport
        commissions={commissions.commissions}
        summary={commissions.summary}
        byMember={commissions.byMember}
        coveredByMember={commissions.coveredByMember}
        members={commissions.members}
        memberNameByUserId={commissions.memberNameByUserId}
        fromDate={range.fromDate}
        toDate={range.toDate}
        fromIso={range.fromIso}
        toIso={range.toIso}
        memberFilter={commissions.memberFilter}
        statusFilter={commissions.statusFilter}
        canMarkPaid={canMarkPaid}
      />
    </div>
  )
}
