import { isFirebaseConfigured } from '@/shared/firebase/config'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Hero } from './Hero'

vi.mock('@/shared/firebase/config', () => ({
  isFirebaseConfigured: vi.fn(),
}))

describe('Hero', () => {
  it('renders title and primary CTA when auth is configured', () => {
    vi.mocked(isFirebaseConfigured).mockReturnValue(true)
    render(<Hero />)
    expect(screen.getByRole('heading', { name: 'Oilio' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /entrar/i })).toHaveAttribute('href', '/login')
  })

  it('hides auth CTAs when Firebase is not configured', () => {
    vi.mocked(isFirebaseConfigured).mockReturnValue(false)
    render(<Hero />)
    expect(screen.getByRole('heading', { name: 'Oilio' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /entrar/i })).not.toBeInTheDocument()
  })
})
