import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LoginForm } from './LoginForm'

vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: vi.fn(function MockGoogleAuthProvider(this: {
    setCustomParameters: () => void
  }) {
    this.setCustomParameters = vi.fn()
  }),
  OAuthProvider: vi.fn(function MockOAuthProvider(this: { setCustomParameters: () => void }) {
    this.setCustomParameters = vi.fn()
  }),
  signInWithPopup: vi.fn(),
}))

vi.mock('@/shared/firebase/client', () => ({
  getClientAuth: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}))

describe('LoginForm', () => {
  it('renders the Google OAuth button', () => {
    render(<LoginForm />)
    expect(screen.getByRole('button', { name: /continuar com google/i })).toBeInTheDocument()
  })
})
