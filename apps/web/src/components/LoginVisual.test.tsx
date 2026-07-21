import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { LoginVisual } from './LoginVisual'

describe('LoginVisual', () => {
  it('composes the montage from real markup, so a screenshot swap would go red', () => {
    render(<LoginVisual />)
    expect(screen.getAllByText('Hoje').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Marcos A.').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Assinantes ativos').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Recebido no mês').length).toBeGreaterThan(0)
  })

  it('renders enough tiles to read as a dense mosaic, not a few loose cards', () => {
    render(<LoginVisual />)
    expect(screen.getAllByText(/Comanda 42|Caixa de hoje|Comissões do mês/).length).toBeGreaterThan(
      4,
    )
  })

  it('varies the surfaces on show instead of repeating one card', () => {
    render(<LoginVisual />)
    for (const surface of [
      'Comanda 42',
      'Caixa de hoje',
      'Comissões do mês',
      'Plano Barba em dia',
      'Ticket médio',
      'Retorno em 30d',
    ]) {
      expect(screen.getAllByText(surface).length).toBeGreaterThan(0)
    }
  })

  it('renders no image asset', () => {
    render(<LoginVisual />)
    expect(screen.queryAllByRole('img')).toHaveLength(0)
  })

  it('renders synchronously, so the login route never waits on data to paint', () => {
    expect(() => render(<LoginVisual />)).not.toThrow()
    expect(screen.getAllByText('48').length).toBeGreaterThan(0)
  })
})
