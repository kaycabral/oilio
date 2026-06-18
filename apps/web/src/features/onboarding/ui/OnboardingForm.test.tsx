import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OnboardingForm } from './OnboardingForm'

vi.mock('@/features/onboarding/adapters/onboarding.actions', () => ({
  createOrg: vi.fn(),
}))

describe('OnboardingForm — ultra-light signup (brief 0046)', () => {
  it('shows the layperson copy (no jargon, no URL filler)', () => {
    render(<OnboardingForm />)
    expect(screen.getByText('Dê um nome ao seu negócio')).toBeInTheDocument()
    expect(screen.getByText('Você pode mudar depois.')).toBeInTheDocument()
    // The verbose v1 filler is gone.
    expect(screen.queryByText(/URL pública/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Criar empresa/i)).not.toBeInTheDocument()
  })

  it('asks only for name + segment (Segmento, never Vertical)', () => {
    render(<OnboardingForm />)
    expect(screen.getByLabelText('Nome do negócio')).toHaveAttribute('name', 'name')
    expect(screen.getByLabelText('Segmento')).toBeInTheDocument()
    expect(screen.queryByText('Vertical')).not.toBeInTheDocument()
  })
})
