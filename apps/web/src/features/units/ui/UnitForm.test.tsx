import type { Unit } from '@/domain'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { UnitForm } from './UnitForm'

vi.mock('@/features/units/adapters/units.actions', () => ({
  createUnit: vi.fn(),
  updateUnit: vi.fn(),
}))

vi.mock('@/hooks/use-cep-lookup', () => ({
  useCepLookup: () => ({ loading: false, data: null, error: null }),
}))

function buildUnit(overrides: Partial<Unit> = {}): Unit {
  return {
    id: 'u1',
    orgId: 't1',
    name: 'Matriz',
    slug: 'matriz',
    whatsapp: '5511900000000',
    email: null,
    address: null,
    businessHours: null,
    archivedAt: null,
    createdAt: '2026-05-18T00:00:00.000Z',
    updatedAt: '2026-05-18T00:00:00.000Z',
    ...overrides,
  }
}

describe('UnitForm — WhatsApp + email (#825)', () => {
  it('renders whatsapp as required and email as optional', () => {
    render(<UnitForm />)
    const wa = screen.getByLabelText(/whatsapp/i)
    const email = screen.getByLabelText(/email/i)
    expect(wa).toHaveAttribute('name', 'whatsapp')
    expect(wa).toBeRequired()
    expect(email).toHaveAttribute('name', 'email')
    expect(email).toHaveAttribute('type', 'email')
    expect(email).not.toBeRequired()
  })

  it('pre-fills whatsapp (masked) and email when editing', () => {
    render(<UnitForm unit={buildUnit({ whatsapp: '5511988887777', email: 'contato@x.com' })} />)
    // The phone field masks the stored number for display.
    expect(screen.getByLabelText(/whatsapp/i)).toHaveValue('(11) 98888-7777')
    expect(screen.getByLabelText(/email/i)).toHaveValue('contato@x.com')
  })

  it('leaves email empty when unit has none', () => {
    render(<UnitForm unit={buildUnit({ email: null })} />)
    expect(screen.getByLabelText(/email/i)).toHaveValue('')
  })
})
