import { isAuthConfigured } from '@/shared/auth/config'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Hero } from './Hero'

vi.mock('@/shared/auth/config', () => ({
  isAuthConfigured: vi.fn(),
}))

const HEADING = /pare de vender atendimento\. comece a construir receita\./i

describe('Hero', () => {
  it('renders title and primary CTA when auth is configured', () => {
    vi.mocked(isAuthConfigured).mockReturnValue(true)
    render(<Hero />)
    expect(screen.getByRole('heading', { name: HEADING })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Começar agora' })).toHaveAttribute(
      'href',
      '/signup/business',
    )
  })

  it('hides auth CTAs when auth is not configured', () => {
    vi.mocked(isAuthConfigured).mockReturnValue(false)
    render(<Hero />)
    expect(screen.getByRole('heading', { name: HEADING })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Começar agora' })).not.toBeInTheDocument()
  })
})
