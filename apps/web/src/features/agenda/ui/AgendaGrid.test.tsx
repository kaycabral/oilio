import type { HoursRange, MemberOperation } from '@/domain'
import { buildAppointment } from '@/shared/fixtures/domain-builders'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AgendaGrid } from './AgendaGrid'

// Brief 0081 (#1312 AC-04): when the "mostrar cancelados" toggle is on, a slot
// holding a `scheduled` + `cancelled` pair renders the two side by side
// (horizontal split, Google-Agenda style) instead of stacked — the cancelled
// card carries its dimmed/struck style and never covers the active one.

const TZ = 'America/Sao_Paulo'
const DAY = '2026-05-15'

const PRO: MemberOperation = {
  id: 'pro-1',
  orgId: 't1',
  userId: 'u-pro1',
  name: 'Ana',
  mobile: '5511900000000',
  email: null,
  taxIdentity: null,
  operationalStatus: 'operational',
  defaultCommission: null,
  unitIds: ['u1'],
  catalogServiceIds: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

// 10:00 in São Paulo (UTC-3) is 13:00Z — inside the 06h–22h grid.
function at(hhmm: string): string {
  return `2026-05-15T${hhmm}:00.000Z`
}

function renderGrid(appts: ReturnType<typeof buildAppointment>[]) {
  return render(
    <AgendaGrid
      memberOperations={[PRO]}
      appointments={appts}
      customersById={{}}
      servicesById={{}}
      date={DAY}
      timezone={TZ}
      slotMinutes={15}
      dayHours={[{ open: '09:00', close: '18:00' }] as HoursRange[]}
      hasBusinessHours
      blockSegments={[]}
      onSelectAppointment={() => {}}
    />,
  )
}

describe('AgendaGrid — horizontal split for overlapping appointments (#1312)', () => {
  it('renders a lone appointment at full column width', () => {
    renderGrid([
      buildAppointment('a1', 't1', at('13:00'), {
        memberOperationId: 'pro-1',
        startAt: at('13:00'),
        endAt: at('13:30'),
      }),
    ])
    const card = screen.getByRole('button')
    // Full width = the original gutter positioning (left + right), no width split.
    expect(card.style.left).toBe('0.25rem')
    expect(card.style.right).toBe('0.25rem')
    expect(card.style.width).toBe('')
  })

  it('splits a scheduled + cancelled pair sharing a slot into two lanes', () => {
    renderGrid([
      buildAppointment('active', 't1', at('13:00'), {
        memberOperationId: 'pro-1',
        startAt: at('13:00'),
        endAt: at('14:00'),
        status: 'scheduled',
      }),
      buildAppointment('cancelled', 't1', at('13:00'), {
        memberOperationId: 'pro-1',
        startAt: at('13:00'),
        endAt: at('14:00'),
        status: 'cancelled',
      }),
    ])
    const cards = screen.getAllByRole('button')
    expect(cards).toHaveLength(2)
    // Both halved; one at the left edge, the other offset by one lane (50%).
    for (const c of cards) expect(c.style.width).toBe('calc(50% - 0.5rem)')
    const lefts = cards.map((c) => c.style.left).sort()
    // JSDOM's CSS engine normalises the calc() term order / spacing.
    expect(lefts[0]).toBe('calc(0% + 0.25rem)')
    expect(lefts[1]).toBe('calc(50% + 0.25rem)')
  })

  it('keeps the cancelled card visually marked (dimmed + struck) without blocking', () => {
    renderGrid([
      buildAppointment('active', 't1', at('13:00'), {
        memberOperationId: 'pro-1',
        startAt: at('13:00'),
        endAt: at('14:00'),
        status: 'scheduled',
      }),
      buildAppointment('cancelled', 't1', at('13:00'), {
        memberOperationId: 'pro-1',
        startAt: at('13:00'),
        endAt: at('14:00'),
        status: 'cancelled',
      }),
    ])
    // The struck/dimmed style belongs to exactly one card (the cancelled one).
    const struck = screen.getAllByRole('button').filter((c) => c.className.includes('line-through'))
    expect(struck).toHaveLength(1)
    expect(struck[0]?.className).toContain('opacity-60')
  })

  it('does not split appointments that do not overlap in time', () => {
    renderGrid([
      buildAppointment('a', 't1', at('13:00'), {
        memberOperationId: 'pro-1',
        startAt: at('13:00'),
        endAt: at('13:30'),
      }),
      buildAppointment('b', 't1', at('14:00'), {
        memberOperationId: 'pro-1',
        startAt: at('14:00'),
        endAt: at('14:30'),
      }),
    ])
    // Disjoint ranges → each keeps the full column.
    for (const c of screen.getAllByRole('button')) {
      expect(c.style.width).toBe('')
      expect(c.style.left).toBe('0.25rem')
    }
  })
})
