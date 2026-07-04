import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PricingComparison } from './PricingComparison'

describe('PricingComparison', () => {
  it('renders the four plan columns in the same order as the cards', () => {
    render(<PricingComparison />)
    const headers = screen.getAllByRole('columnheader')
    // Primeira coluna é o recurso (sr-only "Recurso"); as 4 seguintes são os planos.
    const planNames = headers.slice(1, 5).map((h) => h.textContent)
    expect(planNames).toEqual(['Grátis', 'Pro', 'Avançado', 'Escala'])
  })

  it('groups features by category', () => {
    render(<PricingComparison />)
    // Os títulos de grupo são headers de linha (th com colSpan).
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
    // "Cobrança recorrente automática" é roadmap do Avançado/Escala: a linha carrega
    // exatamente 2 selos "Em breve" (colunas Avançado + Escala), nenhum ✓.
    const row = screen.getByRole('row', { name: /Cobrança recorrente automática/ })
    expect(within(row).getAllByText('Em breve')).toHaveLength(2)
  })

  it('shows literal text cells (e.g. unit/member limits) instead of a bare check', () => {
    render(<PricingComparison />)
    // O Grátis é "1 unidade"; os pagos são "Ilimitadas" — texto, não ✓, pra caber
    // a nuance de limite por tier.
    // O nome do row inclui o texto das células — casar "1 unidade" desambigua da
    // linha-título "Unidades e equipe" (que não tem células de valor).
    const unitsRow = screen.getByRole('row', { name: /Unidades.*1 unidade/ })
    expect(within(unitsRow).getByText('1 unidade')).toBeInTheDocument()
    expect(within(unitsRow).getAllByText('Ilimitadas')).toHaveLength(3)
    // "Membros da equipe": Grátis limitado a "Você + 1" (dono + 1 = 2 no total),
    // pagos ilimitados (a promessa cujo enforcement ainda será construído — feature
    // Lyra pendente).
    const membersRow = screen.getByRole('row', { name: /Membros da equipe/ })
    expect(within(membersRow).getByText('Você + 1')).toBeInTheDocument()
    expect(within(membersRow).getAllByText('Ilimitados')).toHaveLength(3)
  })
})
