import type { ProfilePrefill } from '@/features/onboarding/core/profile-form'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CompleteProfileForm } from './CompleteProfileForm'

vi.mock('@/features/onboarding/adapters/complete-profile.actions', () => ({
  completeProfile: vi.fn(),
}))

function prefill(over: Partial<ProfilePrefill> = {}): ProfilePrefill {
  return {
    name: '',
    email: '',
    mobile: '',
    birthDate: '',
    missing: ['name', 'mobile', 'birthDate'],
    ...over,
  }
}

describe('CompleteProfileForm — progressive profiling (brief 0077 #1277)', () => {
  it('confirms the name the identity gave us instead of re-asking it', () => {
    render(
      <CompleteProfileForm
        prefill={prefill({ name: 'Maria Silva', missing: ['mobile', 'birthDate'] })}
        next="/dashboard"
      />,
    )
    expect(screen.queryByLabelText(/nome/i)).not.toBeInTheDocument()
    expect(screen.getByText(/você é/i).textContent).toMatch(/Maria Silva/)
  })

  it('asks for the name only when the identity gave us none', () => {
    render(
      <CompleteProfileForm
        prefill={prefill({ name: '', missing: ['name', 'mobile', 'birthDate'] })}
        next="/dashboard"
      />,
    )
    expect(screen.getByLabelText(/nome/i)).toBeInTheDocument()
    expect(screen.queryByText(/você é/i)).not.toBeInTheDocument()
  })

  it('marks every required field with the asterisk — name confirmed, no extra input', () => {
    render(
      <CompleteProfileForm
        prefill={prefill({ name: 'Maria Silva', missing: ['mobile', 'birthDate'] })}
        next="/dashboard"
      />,
    )
    expect(screen.getAllByText('*')).toHaveLength(2)
  })

  it('marks the name field required too when it has to be asked', () => {
    render(
      <CompleteProfileForm
        prefill={prefill({ name: '', missing: ['name', 'mobile', 'birthDate'] })}
        next="/dashboard"
      />,
    )
    expect(screen.getAllByText('*')).toHaveLength(3)
  })
})
