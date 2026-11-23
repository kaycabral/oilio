import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PricingComparison } from './PricingComparison'

describe('PricingComparison', () => {
  it('renders the four plan columns in the same order as the cards', () => {
    render(<PricingComparison />)
    const headers = screen.getAllByRole('columnheader')
    const planNames = headers.slice(1, 5).map((h) => h.textContent)
    expect(planNames).toEqual(['Grátis', 'Pro', 'Avançado', 'Escala'])
  })

  it('groups features by category', () => {
    render(<PricingComparison />)
    for (const group of [
      'Agenda e atendimento',
      'Recorrência e receita',
      'Comissão e relatórios',
      'Unidades e equipe',
      'Automação financeira',
      'Suporte e atendimento',
    ]) {
      expect(screen.getByText(group)).toBeInTheDocument()
    }
  })

  it('marks roadmap cells as "Em breve" (packaging honesty, brief 0070 AC-04)', () => {
    render(<PricingComparison />)
    const row = screen.getByRole('row', { name: /Cobrança recorrente automática/ })
    expect(within(row).getAllByText('Em breve')).toHaveLength(2)
  })

  it('shows literal text cells (e.g. unit/member limits) instead of a bare check', () => {
    render(<PricingComparison />)
    const unitsRow = screen.getByRole('row', { name: /Unidades.*1 unidade/ })
    expect(within(unitsRow).getByText('1 unidade')).toBeInTheDocument()
    expect(within(unitsRow).getAllByText('Ilimitadas')).toHaveLength(3)
    const membersRow = screen.getByRole('row', { name: /Membros da equipe/ })
    expect(within(membersRow).getByText('Você + 1')).toBeInTheDocument()
    expect(within(membersRow).getAllByText('Ilimitados')).toHaveLength(3)
  })
})
