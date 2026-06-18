import type { Unit } from '@/domain'
import { EMPTY_ADDRESS, EMPTY_BUSINESS_HOURS } from '@/domain'
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
    address: EMPTY_ADDRESS,
    timezone: 'America/Sao_Paulo',
    agenda: { mode: 'fixed', businessHours: EMPTY_BUSINESS_HOURS },
    archivedAt: null,
    fiscal: { kind: 'informal' },
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

describe('UnitForm — agenda config disclosure (appointment mode, PRD Identidade v2 / C3)', () => {
  it('does NOT render the agenda configs in fixed mode', () => {
    render(
      <UnitForm
        unit={buildUnit({ agenda: { mode: 'fixed', businessHours: EMPTY_BUSINESS_HOURS } })}
      />,
    )
    expect(screen.queryByText(/configurações de agenda/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/granularidade dos horários/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/cancelamento pelo cliente/i)).not.toBeInTheDocument()
  })

  it('does NOT render the agenda configs in always_open mode', () => {
    render(<UnitForm unit={buildUnit({ agenda: { mode: 'always_open' } })} />)
    expect(screen.queryByText(/configurações de agenda/i)).not.toBeInTheDocument()
  })

  it('reveals the agenda configs (slot, cancellation, messages) in appointment mode', () => {
    render(
      <UnitForm
        unit={buildUnit({
          agenda: {
            mode: 'appointment',
            businessHours: EMPTY_BUSINESS_HOURS,
            slotMinutes: 30,
            cancellationPolicy: { enabled: true, minNoticeMinutes: 90 },
            confirmationTemplates: {
              confirmation: 'Confirmado!',
              reminder: 'Lembrete!',
              cancellation: 'Cancelado!',
            },
            selfBookingPublished: false,
          },
        })}
      />,
    )
    expect(screen.getByText(/configurações de agenda/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/granularidade dos horários/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/cancelamento pelo cliente/i)).toBeInTheDocument()
    // Cancellation is enabled, so the min-notice field is shown, prefilled.
    expect(screen.getByLabelText(/antecedência mínima/i)).toHaveValue(90)
    // The message templates are prefilled from the unit's confirmationTemplates.
    expect(screen.getByLabelText(/confirmação/i)).toHaveValue('Confirmado!')
    expect(screen.getByLabelText(/lembrete/i)).toHaveValue('Lembrete!')
    expect(screen.getByLabelText(/^cancelamento$/i)).toHaveValue('Cancelado!')
  })
})
