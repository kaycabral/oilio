import { isSupabaseConfigured } from '@cbrl/supabase'
import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CHARGEABLE_TIER_SLUGS, PricingTiers, tiersMatchDomain } from './PricingTiers'

vi.mock('@cbrl/supabase', () => ({
  isSupabaseConfigured: vi.fn(),
}))

describe('PricingTiers', () => {
  it('the UI cards match the domain tier catalog (no packaging↔enforcement drift)', () => {
    expect(tiersMatchDomain()).toBe(true)
    expect([...CHARGEABLE_TIER_SLUGS].sort()).toEqual(['advanced', 'free', 'pro'])
  })

  it('renders the three tiers with paid CTAs to the owner signup, carrying the plan intent', () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(true)
    render(<PricingTiers />)
    expect(screen.getByText('Grátis')).toBeInTheDocument()
    expect(screen.getByText('Pro')).toBeInTheDocument()
    expect(screen.getByText('Avançado')).toBeInTheDocument()
    expect(screen.getByText('Recomendado')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Assinar o Pro' })).toHaveAttribute(
      'href',
      '/signup/business?intent=pro',
    )
  })

  it('shows the contact tier with a WhatsApp CTA', () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(true)
    render(<PricingTiers />)
    expect(screen.getByText('Escala')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Falar com a gente' })).toHaveAttribute(
      'href',
      'https://wa.me/5592984896424',
    )
  })

  it('keeps the contact tier CTA even when auth is not configured', () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(false)
    render(<PricingTiers />)
    expect(screen.getByRole('link', { name: 'Falar com a gente' })).toBeInTheDocument()
  })

  it('defaults to the annual price and switches to monthly via the toggle', async () => {
    const user = userEvent.setup()
    vi.mocked(isSupabaseConfigured).mockReturnValue(true)
    render(<PricingTiers />)
    expect(screen.getByText('R$ 74')).toBeInTheDocument()
    expect(screen.queryByText('R$ 89')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Mensal' }))
    expect(screen.getByText('R$ 89')).toBeInTheDocument()
  })

  it('hides plan CTAs when auth is not configured', () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(false)
    render(<PricingTiers />)
    expect(screen.getByText('Grátis')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Assinar o Pro' })).not.toBeInTheDocument()
  })

  it('never truncates the annual price note (no line-clamp) so md 2-col keeps it whole', () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(true)
    render(<PricingTiers />)
    const annualNotes = screen.getAllByText(/Cobrado anualmente/)
    expect(annualNotes.length).toBeGreaterThan(0)
    for (const note of annualNotes) {
      expect(note).not.toHaveClass('line-clamp-2')
    }
  })
})
