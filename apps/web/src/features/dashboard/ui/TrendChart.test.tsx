import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TrendChart } from './TrendChart'

const POINTS = [
  { date: '2026-03-13', revenueCents: 10000, newSubs: 1 },
  { date: '2026-03-14', revenueCents: 25000, newSubs: 0 },
  { date: '2026-03-15', revenueCents: 0, newSubs: 2 },
]

describe('TrendChart', () => {
  it('renders a labelled SVG with header and totals', () => {
    render(<TrendChart points={POINTS} />)
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'Gráfico de tendência diária')
    expect(screen.getByText('Faturamento × novos assinantes')).toBeInTheDocument()
    // Legend includes totals — R$ 350,00 across the 3 days; 3 new subs.
    expect(screen.getByText(/Faturamento.*R\$\s?350,00/)).toBeInTheDocument()
    expect(screen.getByText(/Novos assinantes.*3/)).toBeInTheDocument()
  })

  it('shows an empty state when there are no points', () => {
    render(<TrendChart points={[]} />)
    expect(screen.getByText('Sem dados no período.')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
