import type { CashMovementTotals } from '@/domain/utils/cash-register'
import type { CashReportRange } from '@/features/cash/core/range'
import type { SalesSectionData } from '@/features/reports/adapters/sales.repo'
import type { CommissionsSectionData } from '@/features/reports/core/commissions'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./SalesReport', () => ({
  SalesReport: () => <section aria-label="Vendas" />,
}))
vi.mock('./CommissionReport', () => ({
  CommissionReport: () => <section aria-label="Comissões" />,
}))
vi.mock('@/shared/org/org-context', () => ({
  useCapability: () => false,
}))

import { ReportsView } from './ReportsView'

const range: CashReportRange = {
  period: 'day',
  fromDate: '2026-07-01',
  toDate: '2026-07-01',
  fromIso: '2026-07-01T00:00:00Z',
  toIso: '2026-07-01T23:59:59Z',
}

const zeroTotals: CashMovementTotals = {
  totalInCents: 0,
  totalOutCents: 0,
  cashInCents: 0,
  cashOutCents: 0,
  salesByMethod: { cash: 0, credit_card: 0, debit_card: 0, pix: 0 },
  sangriaCents: 0,
  suprimentoCents: 0,
  despesaCents: 0,
  count: 0,
}

const salesData: SalesSectionData = {
  movements: [],
  totals: zeroTotals,
  unitNameById: {},
}

const commissionsData: CommissionsSectionData = {
  commissions: [],
  summary: {
    byStatus: { pendente: { count: 0, totalCents: 0 }, pago: { count: 0, totalCents: 0 } },
    totalCents: 0,
    count: 0,
  },
  byMember: [],
  coveredByMember: [],
  members: [],
  memberNameByUserId: {},
  memberFilter: null,
  statusFilter: null,
}

describe('ReportsView — tier gate (brief 0088)', () => {
  it('shows both reports when both sections are unlocked', () => {
    render(
      <ReportsView range={range} sales={salesData} commissions={commissionsData} canMarkPaid />,
    )
    expect(screen.getByRole('region', { name: 'Vendas' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Comissões' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Fazer upgrade' })).not.toBeInTheDocument()
  })

  it('hides the commissions section (no upsell) when that capability is off', () => {
    render(<ReportsView range={range} sales={salesData} commissions={null} canMarkPaid />)
    expect(screen.getByRole('region', { name: 'Vendas' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Comissões' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Fazer upgrade' })).not.toBeInTheDocument()
  })
})
