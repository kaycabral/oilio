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
    whatsapp: '',
    birthDate: '',
    missing: ['name', 'whatsapp', 'birthDate'],
    ...over,
  }
}

describe('CompleteProfileForm — progressive profiling (brief 0077 #1277)', () => {
  it('pre-fills the name the identity gave us (editable, not re-asked)', () => {
    render(
      <CompleteProfileForm
        prefill={prefill({ name: 'Maria Silva', missing: ['whatsapp', 'birthDate'] })}
        next="/dashboard"
      />,
    )
    expect(screen.getByLabelText(/nome/i)).toHaveValue('Maria Silva')
  })

  it('marks only the still-missing fields with a "falta preencher" hint', () => {
    render(
      <CompleteProfileForm
        prefill={prefill({ name: 'Maria Silva', missing: ['whatsapp', 'birthDate'] })}
        next="/dashboard"
      />,
    )
    // Name is on file → no hint next to it; whatsapp + birthDate are missing.
    const hints = screen.getAllByText(/falta preencher/i)
    expect(hints).toHaveLength(2)
  })

  it('shows no hints when nothing is missing', () => {
    render(
      <CompleteProfileForm
        prefill={prefill({
          name: 'Maria Silva',
          whatsapp: '5511990000000',
          birthDate: '1990-05-05',
          missing: [],
        })}
        next="/dashboard"
      />,
    )
    expect(screen.queryByText(/falta preencher/i)).not.toBeInTheDocument()
  })
})
