import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LoginForm } from './LoginForm'

vi.mock('@cbrl/supabase/client', () => ({
  getSupabaseBrowserClient: vi.fn(() => null),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}))

describe('LoginForm', () => {
  it('renders the Google OAuth button', () => {
    render(<LoginForm />)
    expect(screen.getByRole('button', { name: /continuar com google/i })).toBeInTheDocument()
  })

  it('leads with the brand and a heading', () => {
    render(<LoginForm />)
    expect(screen.getByText('Oilio')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /entre na sua conta/i })).toBeInTheDocument()
  })

  it('ships a short and a full subtitle so the narrow screen is not the wide one truncated', () => {
    render(<LoginForm />)
    expect(screen.getByText(/sua agenda, assinaturas e caixa num lugar só/i)).toBeInTheDocument()
    expect(screen.getByText(/agenda, assinatura e comissão trabalham juntas/i)).toBeInTheDocument()
  })
})
