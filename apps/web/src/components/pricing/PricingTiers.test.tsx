import { isFirebaseConfigured } from '@/shared/firebase/config'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PricingTiers } from './PricingTiers'

vi.mock('@/shared/firebase/config', () => ({
  isFirebaseConfigured: vi.fn(),
}))

describe('PricingTiers', () => {
  it('renders the three tiers with CTAs to login when auth is configured', () => {
    vi.mocked(isFirebaseConfigured).mockReturnValue(true)
    render(<PricingTiers />)
    expect(screen.getByText('Starter')).toBeInTheDocument()
    expect(screen.getByText('Pro')).toBeInTheDocument()
    expect(screen.getByText('Avançado')).toBeInTheDocument()
    expect(screen.getByText('Recomendado')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Assinar o Pro' })).toHaveAttribute('href', '/login')
  })

  it('hides plan CTAs when Firebase is not configured', () => {
    vi.mocked(isFirebaseConfigured).mockReturnValue(false)
    render(<PricingTiers />)
    expect(screen.getByText('Starter')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Assinar o Pro' })).not.toBeInTheDocument()
  })
})
