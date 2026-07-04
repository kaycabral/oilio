import { isFirebaseConfigured } from '@/shared/firebase/config'
import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CHARGEABLE_TIER_SLUGS, PricingTiers, tiersMatchDomain } from './PricingTiers'

vi.mock('@/shared/firebase/config', () => ({
  isFirebaseConfigured: vi.fn(),
}))

describe('PricingTiers', () => {
  it('the UI cards match the domain tier catalog (no packaging↔enforcement drift)', () => {
    // AC-03 (brief 0070): the component consumes the domain catalog; the
    // chargeable cards are exactly the domain's TIERS. Add/remove a tier in the
    // domain and this breaks until the page is updated — promise and gate stay
    // in sync. Escala is contact-sales, not a billing tier, so it's excluded.
    expect(tiersMatchDomain()).toBe(true)
    expect([...CHARGEABLE_TIER_SLUGS].sort()).toEqual(['advanced', 'free', 'pro'])
  })

  it('renders the three tiers with CTAs to login when auth is configured', () => {
    vi.mocked(isFirebaseConfigured).mockReturnValue(true)
    render(<PricingTiers />)
    expect(screen.getByText('Grátis')).toBeInTheDocument()
    expect(screen.getByText('Pro')).toBeInTheDocument()
    expect(screen.getByText('Avançado')).toBeInTheDocument()
    expect(screen.getByText('Recomendado')).toBeInTheDocument()
    // A chargeable tier's CTA points unauthed visitors at /login carrying the
    // chosen plan (next=/settings/billing + intent=<tier>) so the post-login
    // flow can resume the subscription (brief 0073).
    expect(screen.getByRole('link', { name: 'Assinar o Pro' })).toHaveAttribute(
      'href',
      '/login?next=%2Fsettings%2Fbilling&intent=pro',
    )
  })

  it('shows the contact tier with a WhatsApp CTA', () => {
    vi.mocked(isFirebaseConfigured).mockReturnValue(true)
    render(<PricingTiers />)
    expect(screen.getByText('Escala')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Falar com a gente' })).toHaveAttribute(
      'href',
      'https://wa.me/5592984896424',
    )
  })

  it('keeps the contact tier CTA even when Firebase is not configured', () => {
    vi.mocked(isFirebaseConfigured).mockReturnValue(false)
    render(<PricingTiers />)
    // O card de contato não depende de auth — é um canal comercial.
    expect(screen.getByRole('link', { name: 'Falar com a gente' })).toBeInTheDocument()
  })

  it('defaults to the annual price and switches to monthly via the toggle', async () => {
    const user = userEvent.setup()
    vi.mocked(isFirebaseConfigured).mockReturnValue(true)
    render(<PricingTiers />)
    // Anual é o padrão (preço mais atrativo primeiro).
    expect(screen.getByText('R$ 74')).toBeInTheDocument()
    expect(screen.queryByText('R$ 89')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Mensal' }))
    expect(screen.getByText('R$ 89')).toBeInTheDocument()
  })

  it('hides plan CTAs when Firebase is not configured', () => {
    vi.mocked(isFirebaseConfigured).mockReturnValue(false)
    render(<PricingTiers />)
    expect(screen.getByText('Grátis')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Assinar o Pro' })).not.toBeInTheDocument()
  })

  it('never truncates the annual price note (no line-clamp) so md 2-col keeps it whole', () => {
    // O flick (nota anual = 2 linhas onde mensal = 1) e o desalinhamento entre
    // cards da mesma fileira se resolvem com CSS subgrid — validado no browser, já
    // que jsdom não computa layout. O que TRAVAMOS aqui é a regressão que motivou a
    // troca: a nota anual (mais longa) NÃO pode ser truncada com `line-clamp`, senão
    // volta o corte com reticências na faixa md 2-col. O texto fica íntegro no DOM.
    vi.mocked(isFirebaseConfigured).mockReturnValue(true)
    render(<PricingTiers />)
    const annualNotes = screen.getAllByText(/Cobrado anualmente/)
    expect(annualNotes.length).toBeGreaterThan(0)
    for (const note of annualNotes) {
      expect(note).not.toHaveClass('line-clamp-2')
    }
  })
})
