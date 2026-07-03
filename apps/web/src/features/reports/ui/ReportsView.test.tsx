// Render tests for ReportsView (brief 0082 AC-01/AC-03) — proves the gate a
// tester would eyeball: when a section's data is `null` (the tier does not
// unlock it, so the loader did NOT fetch it), the section is replaced by the
// upgrade CTA instead of the report. The heavy child reports are mocked; the
// focus is the null-section → CTA substitution.

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./SalesReport', () => ({
  SalesReport: () => <div data-testid="sales-report" />,
}))
vi.mock('./CommissionReport', () => ({
  CommissionReport: () => <div data-testid="commission-report" />,
}))
vi.mock('@/shared/org/org-context', () => ({
  // UpgradeCta renders the CTA directly (no capability check), but importing the
  // module still pulls org-context — stub it so the render stays isolated.
  useCapability: () => false,
}))

import { ReportsView } from './ReportsView'

const range = {
  period: 'today',
  fromDate: '2026-07-01',
  toDate: '2026-07-01',
  fromIso: '2026-07-01T00:00:00Z',
  toIso: '2026-07-01T23:59:59Z',
} as never

const salesData = { movements: [], totals: {}, unitNameById: {} } as never
const commissionsData = {
  commissions: [],
  summary: {},
  byMember: {},
  coveredByMember: {},
  members: [],
  memberNameByUserId: {},
  memberFilter: null,
  statusFilter: null,
} as never

describe('ReportsView — tier gate', () => {
  it('shows both reports when both sections are unlocked', () => {
    render(
      <ReportsView range={range} sales={salesData} commissions={commissionsData} canMarkPaid />,
    )
    expect(screen.getByTestId('sales-report')).toBeInTheDocument()
    expect(screen.getByTestId('commission-report')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Fazer upgrade' })).not.toBeInTheDocument()
  })

  it('replaces the sales section with the upgrade CTA when locked (null)', () => {
    render(
      <ReportsView range={range} sales={null} commissions={commissionsData} canMarkPaid />,
    )
    expect(screen.queryByTestId('sales-report')).not.toBeInTheDocument()
    expect(screen.getByText(/Relatórios são um recurso do Pro/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Fazer upgrade' })).toHaveAttribute('href', '/billing')
    // Commissions still renders — sections gate independently.
    expect(screen.getByTestId('commission-report')).toBeInTheDocument()
  })

  it('replaces both sections with CTAs when a Free org has neither capability', () => {
    render(<ReportsView range={range} sales={null} commissions={null} canMarkPaid />)
    expect(screen.queryByTestId('sales-report')).not.toBeInTheDocument()
    expect(screen.queryByTestId('commission-report')).not.toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Fazer upgrade' })).toHaveLength(2)
  })
})
