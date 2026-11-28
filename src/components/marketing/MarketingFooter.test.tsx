import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MarketingFooter } from './MarketingFooter'

describe('MarketingFooter', () => {
  it('renders the brand and navigation links', () => {
    render(<MarketingFooter />)
    expect(screen.getByRole('link', { name: 'Preços' })).toHaveAttribute('href', '/pricing')
    expect(screen.getByRole('link', { name: 'Entrar' })).toHaveAttribute('href', '/login')
    expect(screen.getByRole('link', { name: 'Termos' })).toHaveAttribute('href', '/terms')
    expect(screen.getByRole('link', { name: 'Privacidade' })).toHaveAttribute('href', '/privacy')
  })
})
