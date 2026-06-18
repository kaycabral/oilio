import type { Org } from '@/domain'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CompanyForm } from './CompanyForm'

type UpdateCompanyResult = { ok: true } | { ok: false; error: string }
const updateCompany = vi.fn<(fd: FormData) => Promise<UpdateCompanyResult>>()

vi.mock('@/features/company/adapters/company.actions', () => ({
  updateCompany: (fd: FormData): Promise<UpdateCompanyResult> => updateCompany(fd),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn() },
}))

// The Org is a pure folder (PRD Identidade v2, context 3): the company form
// edits only name/slug/vertical/branding. The agenda configs (cancellation
// policy / confirmation messages / slot / self-booking publish) moved to the
// per-unit agenda settings, so they're no longer on this form.
function buildOrg(overrides: Partial<Org> = {}): Org {
  return {
    id: 't1',
    name: 'Barbearia do João',
    slug: 'barbearia-joao',
    vertical: 'barbershop',
    ownerUserId: 'u1',
    branding: { logoUrl: null, bannerUrl: null, description: null },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  updateCompany.mockReset()
})

describe('CompanyForm — folder fields (PRD Identidade v2)', () => {
  it('submits the org folder fields (name/slug/branding)', async () => {
    updateCompany.mockResolvedValue({ ok: true })
    render(<CompanyForm org={buildOrg()} canManage />)
    const saveButton = screen.getByRole('button', { name: /salvar/i })
    const form = saveButton instanceof HTMLButtonElement ? saveButton.form : null
    expect(form).not.toBeNull()
    fireEvent.submit(form ?? saveButton)
    await waitFor(() => expect(updateCompany).toHaveBeenCalledTimes(1))
    const fd = updateCompany.mock.calls[0]![0]
    expect(fd.get('name')).toBe('Barbearia do João')
    expect(fd.get('slug')).toBe('barbearia-joao')
    expect(fd.get('vertical')).toBe('barbershop')
  })

  it('does NOT render the agenda configs that moved to the unit (cancellation policy)', () => {
    render(<CompanyForm org={buildOrg()} canManage />)
    expect(screen.queryByText(/política de cancelamento/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/antecedência mínima sugerida/i)).not.toBeInTheDocument()
  })
})
