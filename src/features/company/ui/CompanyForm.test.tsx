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

function buildOrg(overrides: Partial<Org> = {}): Org {
  return {
    id: 't1',
    name: 'Barbearia do João',
    slug: 'barbearia-joao',
    vertical: 'barbershop',
    website: null,
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
  it('submits the negócio folder fields (name/segment/website/branding)', async () => {
    updateCompany.mockResolvedValue({ ok: true })
    render(<CompanyForm org={buildOrg({ website: 'https://barbearia.com' })} canManage />)
    const saveButton = screen.getByRole('button', { name: /salvar/i })
    const form = saveButton instanceof HTMLButtonElement ? saveButton.form : null
    expect(form).not.toBeNull()
    fireEvent.submit(form ?? saveButton)
    await waitFor(() => expect(updateCompany).toHaveBeenCalledTimes(1))
    const fd = updateCompany.mock.calls[0]![0]
    expect(fd.get('name')).toBe('Barbearia do João')
    expect(fd.get('vertical')).toBe('barbershop')
    expect(fd.get('website')).toBe('https://barbearia.com')
  })

  it('surfaces the Segmento label (renamed from Vertical) and the Site field', () => {
    render(<CompanyForm org={buildOrg()} canManage />)
    expect(screen.getByText('Segmento')).toBeInTheDocument()
    expect(screen.getByLabelText('Site')).toBeInTheDocument()
  })

  it('defers the public slug — no slug editor on the folder form', () => {
    render(<CompanyForm org={buildOrg()} canManage />)
    expect(screen.queryByLabelText(/slug público/i)).not.toBeInTheDocument()
  })

  it('does NOT render the agenda configs that moved to the unit (cancellation policy)', () => {
    render(<CompanyForm org={buildOrg()} canManage />)
    expect(screen.queryByText(/política de cancelamento/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/antecedência mínima sugerida/i)).not.toBeInTheDocument()
  })
})
