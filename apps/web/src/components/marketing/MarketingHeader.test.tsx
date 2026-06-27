import { isFirebaseConfigured } from '@/shared/firebase/config'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MarketingHeader } from './MarketingHeader'

vi.mock('@/shared/firebase/config', () => ({
  isFirebaseConfigured: vi.fn(),
}))

describe('MarketingHeader', () => {
  it('shows the pricing link and auth CTAs when auth is configured', () => {
    vi.mocked(isFirebaseConfigured).mockReturnValue(true)
    render(<MarketingHeader />)
    expect(screen.getByRole('link', { name: 'Preços' })).toHaveAttribute('href', '/pricing')
    expect(screen.getByRole('link', { name: 'Entrar' })).toHaveAttribute('href', '/login')
    expect(screen.getByRole('link', { name: 'Começar agora' })).toHaveAttribute('href', '/login')
  })

  it('hides auth CTAs when Firebase is not configured', () => {
    vi.mocked(isFirebaseConfigured).mockReturnValue(false)
    render(<MarketingHeader />)
    expect(screen.getByRole('link', { name: 'Preços' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Entrar' })).not.toBeInTheDocument()
  })
})
