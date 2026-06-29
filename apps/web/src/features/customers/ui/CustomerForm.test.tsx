import type { Customer } from '@/domain'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CustomerForm } from './CustomerForm'

vi.mock('@/features/customers/adapters/customers.actions', () => ({
  updateCustomer: vi.fn(),
}))

// CustomerForm is edit-only since #1279 (creation became the contextual invite).
function customer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 'c1',
    orgId: 't1',
    userId: 'u1',
    name: 'Maria',
    whatsapp: '+5511900000000',
    email: null,
    birthDate: null,
    avatarUrl: null,
    archivedAt: null,
    deactivatedAt: null,
    acquisition: null,
    createdAt: '2026-05-16T00:00:00.000Z',
    updatedAt: '2026-05-16T00:00:00.000Z',
    ...overrides,
  }
}

describe('CustomerForm — birthDate (#819)', () => {
  it('renders an optional birthDate field (masked pt-BR text input)', () => {
    render(<CustomerForm customer={customer()} />)
    // The visible control is the design DateField's masked pt-BR text input; the
    // ISO value it submits under `name="birthDate"` is covered by DateField.
    const input = screen.getByLabelText(/data de nascimento/i)
    expect(input).toHaveAttribute('type', 'text')
    expect(input).not.toBeRequired()
  })

  it('offers a calendar picker (the today-cap is enforced + tested in DateField)', () => {
    render(<CustomerForm customer={customer()} />)
    expect(screen.getByRole('button', { name: 'Abrir calendário' })).toBeInTheDocument()
  })

  it('pre-fills birthDate when editing an existing customer', () => {
    render(<CustomerForm customer={customer({ birthDate: '1990-05-16' })} />)
    // Visible field shows the pt-BR mask; the hidden input carries the ISO value.
    expect(screen.getByLabelText(/data de nascimento/i)).toHaveValue('16/05/1990')
    expect(screen.getByDisplayValue('1990-05-16')).toBeInTheDocument()
  })

  it('leaves the field empty when customer has no birthDate', () => {
    render(<CustomerForm customer={customer({ birthDate: null })} />)
    const input = screen.getByLabelText(/data de nascimento/i)
    expect(input).toHaveValue('')
  })
})
