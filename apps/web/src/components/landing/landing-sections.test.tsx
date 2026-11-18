import { isAuthConfigured } from '@/shared/auth/config'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ClosingCta } from './ClosingCta'
import { Features } from './Features'
import { HowItWorks } from './HowItWorks'
import { Verticals } from './Verticals'

vi.mock('@/shared/auth/config', () => ({
  isAuthConfigured: vi.fn(() => true),
}))

describe('landing sections', () => {
  it('Features renders the benefit cards', () => {
    render(<Features />)
    expect(screen.getByText('Encha a agenda sozinho')).toBeInTheDocument()
    expect(screen.getByText('Cobre todo mês, no automático')).toBeInTheDocument()
    expect(screen.getByText('Feche a comanda e a comissão sai pronta')).toBeInTheDocument()
    expect(screen.getByText('Comande várias unidades de um lugar')).toBeInTheDocument()
  })

  it('Verticals marks active verticals and lists upcoming ones', () => {
    render(<Verticals />)
    expect(screen.getByText('Barbearia')).toBeInTheDocument()
    expect(screen.getByText('Estética automotiva')).toBeInTheDocument()
    expect(screen.getAllByText('Ativo')).toHaveLength(2)
    expect(screen.getByText('Pet')).toBeInTheDocument()
  })

  it('HowItWorks renders the three tiers progression', () => {
    render(<HowItWorks />)
    expect(screen.getByText('Comece pelo avulso')).toBeInTheDocument()
    expect(screen.getByText('Fidelize com recorrência')).toBeInTheDocument()
    expect(screen.getByText('Escale com assinatura')).toBeInTheDocument()
  })

  it('ClosingCta converts to login when auth is configured', () => {
    vi.mocked(isAuthConfigured).mockReturnValue(true)
    render(<ClosingCta />)
    expect(screen.getByRole('link', { name: 'Começar agora' })).toHaveAttribute(
      'href',
      '/signup/business',
    )
  })

  it('ClosingCta renders nothing when auth is not configured', () => {
    vi.mocked(isAuthConfigured).mockReturnValue(false)
    const { container } = render(<ClosingCta />)
    expect(container).toBeEmptyDOMElement()
  })
})
