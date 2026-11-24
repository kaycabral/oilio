import { isSupabaseConfigured } from '@cbrl/supabase'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MarketingHeader } from './MarketingHeader'

vi.mock('@cbrl/supabase', () => ({
  isSupabaseConfigured: vi.fn(),
}))

describe('MarketingHeader', () => {
  it('shows the pricing link and auth CTAs when auth is configured', () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(true)
    render(<MarketingHeader />)
    expect(screen.getByRole('link', { name: 'Preços' })).toHaveAttribute('href', '/pricing')
    expect(screen.getByRole('link', { name: 'Entrar' })).toHaveAttribute('href', '/login')
    expect(screen.getByRole('link', { name: 'Começar agora' })).toHaveAttribute(
      'href',
      '/signup/business',
    )
  })

  it('hides auth CTAs when auth is not configured', () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(false)
    render(<MarketingHeader />)
    expect(screen.getByRole('link', { name: 'Preços' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Entrar' })).not.toBeInTheDocument()
  })
})
