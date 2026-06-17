import type { Unit } from '@/domain'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PlanCoverageBanner } from './PlanCoverageBanner'

// Minimum-viable Unit fixture — banner only reads `id` + `name`, so the
// rest is filler matching the schema for type safety.
function makeUnit(id: string, name: string): Unit {
  return {
    id,
    tenantId: 't1',
    name,
    slug: id,
    whatsapp: '5511900000000',
    email: null,
    address: null,
    businessHours: null,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

const ALL_UNITS: Unit[] = [
  makeUnit('u-alvorada', 'Alvorada'),
  makeUnit('u-djalma', 'Djalma'),
  makeUnit('u-centro', 'Centro'),
]

describe('PlanCoverageBanner', () => {
  it('returns null when every axis is unrestricted', () => {
    const { container } = render(
      <PlanCoverageBanner
        unitAllowlist={null}
        allowedTimeScope={null}
        bookingLimits={null}
        units={ALL_UNITS}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders 1 unit allowlist as bare name', () => {
    render(
      <PlanCoverageBanner
        unitAllowlist={new Set(['u-alvorada'])}
        allowedTimeScope={null}
        bookingLimits={null}
        units={ALL_UNITS}
      />,
    )
    expect(screen.getByRole('note', { name: 'Seu plano cobre' })).toHaveTextContent('Alvorada')
  })

  it('renders 2 units joined by "e"', () => {
    render(
      <PlanCoverageBanner
        unitAllowlist={new Set(['u-alvorada', 'u-djalma'])}
        allowedTimeScope={null}
        bookingLimits={null}
        units={ALL_UNITS}
      />,
    )
    expect(screen.getByRole('note', { name: 'Seu plano cobre' })).toHaveTextContent(
      'Alvorada e Djalma',
    )
  })

  it('renders 3 units with comma + "e" before the last', () => {
    render(
      <PlanCoverageBanner
        unitAllowlist={new Set(['u-alvorada', 'u-djalma', 'u-centro'])}
        allowedTimeScope={null}
        bookingLimits={null}
        units={ALL_UNITS}
      />,
    )
    expect(screen.getByRole('note', { name: 'Seu plano cobre' })).toHaveTextContent(
      'Alvorada, Djalma e Centro',
    )
  })

  it('collapses Mon-Fri into "seg a sex"', () => {
    render(
      <PlanCoverageBanner
        unitAllowlist={null}
        allowedTimeScope={{ daysOfWeek: [1, 2, 3, 4, 5] }}
        bookingLimits={null}
        units={ALL_UNITS}
      />,
    )
    expect(screen.getByRole('note', { name: 'Seu plano cobre' })).toHaveTextContent('seg a sex')
  })

  it('keeps weekend days as a comma list', () => {
    render(
      <PlanCoverageBanner
        unitAllowlist={null}
        allowedTimeScope={{ daysOfWeek: [0, 6] }}
        bookingLimits={null}
        units={ALL_UNITS}
      />,
    )
    expect(screen.getByRole('note', { name: 'Seu plano cobre' })).toHaveTextContent('dom, sáb')
  })

  it('formats whole-hour ranges without the minute suffix', () => {
    render(
      <PlanCoverageBanner
        unitAllowlist={null}
        allowedTimeScope={{ hourRange: { start: '08:00', end: '18:00' } }}
        bookingLimits={null}
        units={ALL_UNITS}
      />,
    )
    expect(screen.getByRole('note', { name: 'Seu plano cobre' })).toHaveTextContent('08h às 18h')
  })

  it('keeps the minute suffix when the range starts at a half hour', () => {
    render(
      <PlanCoverageBanner
        unitAllowlist={null}
        allowedTimeScope={{ hourRange: { start: '08:30', end: '18:00' } }}
        bookingLimits={null}
        units={ALL_UNITS}
      />,
    )
    expect(screen.getByRole('note', { name: 'Seu plano cobre' })).toHaveTextContent('08h30 às 18h')
  })

  it('pluralizes advanceBookingDays', () => {
    render(
      <PlanCoverageBanner
        unitAllowlist={null}
        allowedTimeScope={{ advanceBookingDays: 7 }}
        bookingLimits={null}
        units={ALL_UNITS}
      />,
    )
    expect(screen.getByRole('note', { name: 'Seu plano cobre' })).toHaveTextContent(
      'até 7 dias de antecedência',
    )
  })

  it('keeps singular for advanceBookingDays = 1', () => {
    render(
      <PlanCoverageBanner
        unitAllowlist={null}
        allowedTimeScope={{ advanceBookingDays: 1 }}
        bookingLimits={null}
        units={ALL_UNITS}
      />,
    )
    expect(screen.getByRole('note', { name: 'Seu plano cobre' })).toHaveTextContent(
      'até 1 dia de antecedência',
    )
  })

  it('renders maxPerDay but ignores maxConcurrent and requireCompleteBeforeNext', () => {
    render(
      <PlanCoverageBanner
        unitAllowlist={null}
        allowedTimeScope={null}
        bookingLimits={{ maxPerDay: 2, maxConcurrent: 3, requireCompleteBeforeNext: true }}
        units={ALL_UNITS}
      />,
    )
    const banner = screen.getByRole('note', { name: 'Seu plano cobre' })
    expect(banner).toHaveTextContent('2 agendamentos por dia')
    expect(banner).not.toHaveTextContent('simultâneo')
    expect(banner).not.toHaveTextContent('Conclua')
  })

  it('combines multiple axes with ", "', () => {
    render(
      <PlanCoverageBanner
        unitAllowlist={new Set(['u-alvorada'])}
        allowedTimeScope={{
          daysOfWeek: [1, 2, 3, 4, 5],
          hourRange: { start: '09:00', end: '18:00' },
          advanceBookingDays: 3,
        }}
        bookingLimits={{ maxPerDay: 1 }}
        units={ALL_UNITS}
      />,
    )
    expect(screen.getByRole('note', { name: 'Seu plano cobre' })).toHaveTextContent(
      'Alvorada, seg a sex, 09h às 18h, até 3 dias de antecedência, 1 agendamento por dia',
    )
  })
})
