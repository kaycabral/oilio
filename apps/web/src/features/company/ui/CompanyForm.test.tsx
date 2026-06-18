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
    ownerUserId: 'u1',
    selfBookingPublished: false,
    selfBookingPublishedAt: null,
    timezone: 'America/Sao_Paulo',
    slotMinutes: 15,
    branding: { logoUrl: null, bannerUrl: null, description: null },
    cancellationPolicy: { enabled: false, minNoticeMinutes: 120 },
    whatsappTemplates: { confirmation: '', reminder: '', cancellation: '' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  updateCompany.mockReset()
})

describe('CompanyForm — cancellation policy (#871)', () => {
  it('hides the notice-minutes input until the cancellation toggle is enabled (#871)', () => {
    render(<CompanyForm org={buildOrg()} canManage />)
    expect(screen.queryByText(/antecedência mínima sugerida/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText(/ativar política de cancelamento/i))
    expect(screen.getByText(/antecedência mínima sugerida/i)).toBeInTheDocument()
  })

  it('submits enabled + minNoticeMinutes when toggle is on (#871)', async () => {
    updateCompany.mockResolvedValue({ ok: true })
    render(<CompanyForm org={buildOrg()} canManage />)
    fireEvent.click(screen.getByLabelText(/ativar política de cancelamento/i))
    const input = screen.getByLabelText(/antecedência mínima sugerida/i)
    fireEvent.change(input, { target: { value: '60' } })
    const saveButton = screen.getByRole('button', { name: /salvar/i })
    const form = saveButton instanceof HTMLButtonElement ? saveButton.form : null
    expect(form).not.toBeNull()
    fireEvent.submit(form ?? saveButton)
    await waitFor(() => expect(updateCompany).toHaveBeenCalledTimes(1))
    const fd = updateCompany.mock.calls[0]![0]
    expect(fd.get('cancellationPolicyEnabled')).toBe('on')
    expect(fd.get('cancellationPolicyMinNoticeMinutes')).toBe('60')
  })

  it('preserves minNoticeMinutes across enable → disable (#871)', () => {
    render(
      <CompanyForm
        org={buildOrg({ cancellationPolicy: { enabled: true, minNoticeMinutes: 240 } })}
        canManage
      />,
    )
    // When enabled, the visible input shows 240.
    const visible = screen.getByLabelText(/antecedência mínima sugerida/i)
    expect(visible).toHaveDisplayValue('240')
    // Toggle off: the value persists in a hidden input so a future re-enable
    // restores it without retyping.
    fireEvent.click(screen.getByLabelText(/ativar política de cancelamento/i))
    const saveButton = screen.getByRole('button', { name: /salvar/i })
    const form = saveButton instanceof HTMLButtonElement ? saveButton.form : null
    expect(form).not.toBeNull()
    const fd = new FormData(form ?? undefined)
    expect(fd.has('cancellationPolicyEnabled')).toBe(false)
    expect(fd.get('cancellationPolicyMinNoticeMinutes')).toBe('240')
  })
})
