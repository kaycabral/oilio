import type { CreateOrgResult } from '@/features/onboarding/adapters/onboarding.actions'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OnboardingForm } from './OnboardingForm'

const createOrg = vi.fn<(fd: FormData) => Promise<CreateOrgResult>>()
vi.mock('@/features/onboarding/adapters/onboarding.actions', () => ({
  createOrg: (fd: FormData) => createOrg(fd),
}))

const replace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
}))

beforeEach(() => {
  createOrg.mockReset()
  replace.mockReset()
})

function submitForm() {
  const submit = screen.getByRole('button', { name: /Criar negócio/i })
  const form = submit instanceof HTMLButtonElement ? submit.form : null
  expect(form).not.toBeNull()
  fireEvent.submit(form ?? submit)
}

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

  // First Negócio (post-signup) enters the app on success (Fix 1) — unlike the
  // additional-Negócio dialog, which does a soft in-place context switch.
  it('enters the app (router.replace) on a successful create', async () => {
    createOrg.mockResolvedValue({ ok: true, orgId: 'org-1' })
    render(<OnboardingForm />)

    submitForm()

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'))
  })

  it('shows the error and stays put when create fails', async () => {
    createOrg.mockResolvedValue({ ok: false, error: 'Nope' })
    render(<OnboardingForm />)

    submitForm()

    expect(await screen.findByText('Nope')).toBeInTheDocument()
    expect(replace).not.toHaveBeenCalled()
  })
})
