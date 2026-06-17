import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CustomerForm } from './CustomerForm'

vi.mock('@/features/customers/adapters/customers.actions', () => ({
  createCustomer: vi.fn(),
  updateCustomer: vi.fn(),
}))

describe('CustomerForm — birthDate (#819)', () => {
  it('renders an optional birthDate field (masked pt-BR text input)', () => {
    render(<CustomerForm />)
    // The visible control is the design DateField's masked pt-BR text input; the
    // ISO value it submits under `name="birthDate"` is covered by DateField.
    const input = screen.getByLabelText(/data de nascimento/i)
    expect(input).toHaveAttribute('type', 'text')
    expect(input).not.toBeRequired()
  })

  it('offers a calendar picker (the today-cap is enforced + tested in DateField)', () => {
    render(<CustomerForm />)
    expect(screen.getByRole('button', { name: 'Abrir calendário' })).toBeInTheDocument()
  })

  it('pre-fills birthDate when editing an existing customer', () => {
    render(
      <CustomerForm
        customer={{
          id: 'c1',
          tenantId: 't1',
          userId: 'u1',
          name: 'Maria',
          whatsapp: '+5511900000000',
          email: null,
          birthDate: '1990-05-16',
          avatarUrl: null,
          archivedAt: null,
          deactivatedAt: null,
          createdAt: '2026-05-16T00:00:00.000Z',
          updatedAt: '2026-05-16T00:00:00.000Z',
        }}
      />,
    )
    // Visible field shows the pt-BR mask; the hidden input carries the ISO value.
    expect(screen.getByLabelText(/data de nascimento/i)).toHaveValue('16/05/1990')
    expect(screen.getByDisplayValue('1990-05-16')).toBeInTheDocument()
  })

  it('leaves the field empty when customer has no birthDate', () => {
    render(
      <CustomerForm
        customer={{
          id: 'c1',
          tenantId: 't1',
          userId: 'u1',
          name: 'Maria',
          whatsapp: '+5511900000000',
          email: null,
          birthDate: null,
          avatarUrl: null,
          archivedAt: null,
          deactivatedAt: null,
          createdAt: '2026-05-16T00:00:00.000Z',
          updatedAt: '2026-05-16T00:00:00.000Z',
        }}
      />,
    )
    const input = screen.getByLabelText(/data de nascimento/i)
    expect(input).toHaveValue('')
  })
})
