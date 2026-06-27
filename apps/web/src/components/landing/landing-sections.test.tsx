import { isFirebaseConfigured } from '@/shared/firebase/config'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ClosingCta } from './ClosingCta'
import { Features } from './Features'
import { HowItWorks } from './HowItWorks'
import { Verticals } from './Verticals'

vi.mock('@/shared/firebase/config', () => ({
  isFirebaseConfigured: vi.fn(() => true),
}))

describe('landing sections', () => {
  it('Features renders the benefit cards', () => {
    render(<Features />)
    expect(screen.getByText('Agenda inteligente')).toBeInTheDocument()
    expect(screen.getByText('Assinatura nativa')).toBeInTheDocument()
    expect(screen.getByText('Comissão por profissional')).toBeInTheDocument()
    expect(screen.getByText('Multi-unidade')).toBeInTheDocument()
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
    expect(screen.getByText('Crie a recorrência')).toBeInTheDocument()
    expect(screen.getByText('Escale com assinatura')).toBeInTheDocument()
  })

  it('ClosingCta converts to login when auth is configured', () => {
    vi.mocked(isFirebaseConfigured).mockReturnValue(true)
    render(<ClosingCta />)
    expect(screen.getByRole('link', { name: 'Começar agora' })).toHaveAttribute('href', '/login')
  })

  it('ClosingCta renders nothing when Firebase is not configured', () => {
    vi.mocked(isFirebaseConfigured).mockReturnValue(false)
    const { container } = render(<ClosingCta />)
    expect(container).toBeEmptyDOMElement()
  })
})
