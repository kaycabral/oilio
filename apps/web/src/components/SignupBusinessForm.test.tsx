import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SignupBusinessForm } from './SignupBusinessForm'

const searchParams = { value: new URLSearchParams() }

vi.mock('@cbrl/supabase/client', () => ({
  getSupabaseBrowserClient: vi.fn(() => null),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParams.value,
}))

let capturedNext: string | undefined
vi.mock('@/components/oauth-sign-in-buttons', () => ({
  OAuthSignInButtons: ({ next }: { next: string }) => {
    capturedNext = next
    return <button type="button">Continuar com Google</button>
  },
}))

describe('SignupBusinessForm', () => {
  it('leads with the owner-facing brand and heading', () => {
    searchParams.value = new URLSearchParams()
    render(<SignupBusinessForm />)
    expect(screen.getByText('Oilio')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /crie seu negócio no oilio/i })).toBeInTheDocument()
  })

  it('renders the Google OAuth button', () => {
    searchParams.value = new URLSearchParams()
    render(<SignupBusinessForm />)
    expect(screen.getByRole('button', { name: /continuar com google/i })).toBeInTheDocument()
  })

  it('offers a return path to /login for existing accounts', () => {
    searchParams.value = new URLSearchParams()
    render(<SignupBusinessForm />)
    const entrar = screen.getByRole('link', { name: /entrar/i })
    expect(entrar).toHaveAttribute('href', '/login')
  })

  it('sends the owner to /onboarding after auth, not to a client signup destination', () => {
    searchParams.value = new URLSearchParams()
    render(<SignupBusinessForm />)
    expect(capturedNext).toBe('/onboarding')
  })

  it('preserves a plan intent through to /onboarding', () => {
    searchParams.value = new URLSearchParams('intent=pro')
    render(<SignupBusinessForm />)
    expect(capturedNext).toBe('/onboarding?intent=pro')
  })
})
