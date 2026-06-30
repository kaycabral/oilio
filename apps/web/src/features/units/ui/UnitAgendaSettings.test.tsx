import type { Unit, UnitAgendaConfig } from '@/domain'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { UnitAgendaSettings } from './UnitAgendaSettings'

const EMPTY_HOURS = {
  monday: null,
  tuesday: null,
  wednesday: null,
  thursday: null,
  friday: null,
  saturday: null,
  sunday: null,
}

const APPOINTMENT_AGENDA: UnitAgendaConfig = {
  mode: 'appointment',
  businessHours: EMPTY_HOURS,
  slotMinutes: 30,
  cancellationPolicy: { enabled: true, minNoticeMinutes: 120 },
  confirmationTemplates: {
    confirmation: 'Olá! Seu horário está confirmado.',
    reminder: 'Lembrete do seu horário amanhã.',
    cancellation: 'Seu horário foi cancelado.',
  },
}

function buildUnit(agenda: UnitAgendaConfig): Unit {
  return {
    id: 'unit-1',
    orgId: 't1',
    name: 'Unidade Centro',
    slug: 'centro',
    whatsapp: '5511999999999',
    email: null,
    address: {
      postalCode: '01000-000',
      state: 'SP',
      city: 'São Paulo',
      neighborhood: 'Centro',
      street: 'Rua A',
      number: '10',
      complement: null,
    },
    timezone: 'America/Sao_Paulo',
    agenda,
    archivedAt: null,
    fiscal: { kind: 'informal' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('UnitAgendaSettings — appointment-mode-only (PRD Identidade v2 / C3)', () => {
  it('renders the cancellation policy + messages in appointment mode', () => {
    render(<UnitAgendaSettings unit={buildUnit(APPOINTMENT_AGENDA)} />)
    expect(screen.getByText(/política de cancelamento/i)).toBeInTheDocument()
    expect(screen.getByText(/antecedência mínima de 120 minutos/i)).toBeInTheDocument()
    expect(screen.getByText('Olá! Seu horário está confirmado.')).toBeInTheDocument()
    expect(screen.getByText('Lembrete do seu horário amanhã.')).toBeInTheDocument()
  })

  it('renders NOTHING in fixed mode (configs do not exist outside agenda mode)', () => {
    const { container } = render(
      <UnitAgendaSettings unit={buildUnit({ mode: 'fixed', businessHours: EMPTY_HOURS })} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders NOTHING in always_open mode', () => {
    const { container } = render(<UnitAgendaSettings unit={buildUnit({ mode: 'always_open' })} />)
    expect(container).toBeEmptyDOMElement()
  })
})
