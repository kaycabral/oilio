import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { KpiCard, deltaPctFor, formatCents, formatCount, formatPercent } from './KpiCard'

describe('formatters', () => {
  it('formatCents renders BRL with cents precision', () => {
    expect(formatCents(123456)).toMatch(/R\$\s?1\.234,56/)
    expect(formatCents(0)).toMatch(/R\$\s?0,00/)
  })
  it('formatCount uses pt-BR thousands separator', () => {
    expect(formatCount(1234567)).toBe('1.234.567')
  })
  it('formatPercent uses pt-BR decimal separator', () => {
    expect(formatPercent(33.3)).toBe('33,3%')
    expect(formatPercent(0)).toBe('0,0%')
  })
})

describe('deltaPctFor', () => {
  it('returns null when previous is unknown (snapshot metric)', () => {
    expect(deltaPctFor(100, null)).toBeNull()
  })
  it('returns 0 when both are zero', () => {
    expect(deltaPctFor(0, 0)).toBe(0)
  })
  it('returns null when previous is zero and current is not (avoid infinite delta)', () => {
    expect(deltaPctFor(50, 0)).toBeNull()
  })
  it('computes signed percentage with one decimal', () => {
    expect(deltaPctFor(120, 100)).toBe(20)
    expect(deltaPctFor(80, 100)).toBe(-20)
    expect(deltaPctFor(105, 100)).toBe(5)
  })
})

describe('KpiCard', () => {
  it('renders label, value, and delta when comparison is available', () => {
    render(
      <KpiCard
        label="Faturamento"
        formattedValue="R$ 1.000,00"
        previousFormatted="R$ 800,00"
        deltaPct={25}
      />,
    )
    expect(screen.getByText('Faturamento')).toBeInTheDocument()
    expect(screen.getByText('R$ 1.000,00')).toBeInTheDocument()
    expect(screen.getByText('+25.0%')).toBeInTheDocument()
    expect(screen.getByText('vs R$ 800,00')).toBeInTheDocument()
  })

  it('renders "Snapshot atual" when no previous value is provided', () => {
    render(<KpiCard label="MRR" formattedValue="R$ 5.000,00" previousFormatted={null} />)
    expect(screen.getByText('Snapshot atual')).toBeInTheDocument()
  })

  it('renders "—" delta when deltaPct is null but a previous label exists', () => {
    render(
      <KpiCard
        label="Ticket médio"
        formattedValue="R$ 50,00"
        previousFormatted="R$ 0,00"
        deltaPct={null}
      />,
    )
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})
