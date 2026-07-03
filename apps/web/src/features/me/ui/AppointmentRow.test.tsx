import { DEFAULT_CANCELLATION_POLICY } from '@/domain'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppointmentRow, type AppointmentRowData } from './AppointmentRow'

// `rescheduleOwnAppointment` is the server action the panel calls. Stub it at
// that boundary; `useRouter().refresh` is the contract the fix relies on — a
// successful reschedule must refresh so the Server Component re-renders with the
// new (server-projected) start/end labels instead of a stale "atualize a
// página" banner showing the old time (#B9).
const rescheduleOwnAppointment = vi.fn()
const cancelOwnAppointment = vi.fn()
// #1318: the panel fetches the professional's cross-unit busy per selected day.
const loadOwnRescheduleBusy = vi.fn()
const refresh = vi.fn()

vi.mock('@/features/me/adapters/appointments.actions', () => ({
  rescheduleOwnAppointment: (args: unknown): unknown => rescheduleOwnAppointment(args),
  cancelOwnAppointment: (args: unknown): unknown => cancelOwnAppointment(args),
  loadOwnRescheduleBusy: (args: unknown): unknown => loadOwnRescheduleBusy(args),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}))

function buildData(overrides: Partial<AppointmentRowData> = {}): AppointmentRowData {
  return {
    orgId: 'org-1',
    orgSlug: 'acme',
    unitSlug: 'centro',
    appointmentId: 'a1',
    serviceName: 'Corte',
    memberOperationName: 'Zé',
    unitName: 'Centro',
    startAtLabel: 'qui., 02 de jul., 10:00',
    endAtLabel: '10:30',
    priceLabel: 'R$ 45,00',
    status: 'scheduled',
    canCancel: true,
    cancelReason: null,
    cancellationPolicy: DEFAULT_CANCELLATION_POLICY,
    reschedule: {
      slotMinutes: 30,
      businessHours: {
        monday: { open: '09:00', close: '18:00' },
        tuesday: { open: '09:00', close: '18:00' },
        wednesday: { open: '09:00', close: '18:00' },
        thursday: { open: '09:00', close: '18:00' },
        friday: { open: '09:00', close: '18:00' },
        saturday: null,
        sunday: null,
      },
      timezone: 'America/Sao_Paulo',
      durationMinutes: 30,
    },
    ...overrides,
  }
}

beforeEach(() => {
  rescheduleOwnAppointment.mockReset()
  cancelOwnAppointment.mockReset()
  loadOwnRescheduleBusy.mockReset()
  // Default: the professional has no busy interval, so the grid is unfiltered.
  loadOwnRescheduleBusy.mockResolvedValue({ ok: true, busy: [] })
  refresh.mockReset()
})

describe('AppointmentRow — reschedule refreshes the row (#B9)', () => {
  it('refreshes the server view on a successful reschedule (no stale banner)', async () => {
    rescheduleOwnAppointment.mockResolvedValue({ ok: true })
    render(<AppointmentRow data={buildData()} />)

    // Open the inline reschedule panel, pick a slot, confirm.
    fireEvent.click(screen.getByRole('button', { name: /^reagendar$/i }))
    fireEvent.click(screen.getByRole('combobox', { name: /novo horário/i }))
    fireEvent.click(screen.getByRole('option', { name: '10:00' }))
    fireEvent.click(screen.getByRole('button', { name: /confirmar novo horário/i }))

    await waitFor(() => expect(rescheduleOwnAppointment).toHaveBeenCalledTimes(1))
    // The fix: refresh() pulls the new server-rendered time in, rather than
    // showing the old "Atualize a página para ver o novo horário" banner.
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(/atualize a página/i)).not.toBeInTheDocument()
  })

  it('does not refresh when the reschedule fails (surfaces the error)', async () => {
    rescheduleOwnAppointment.mockResolvedValue({
      ok: false,
      error: 'Conflito com agendamento existente',
    })
    render(<AppointmentRow data={buildData()} />)

    fireEvent.click(screen.getByRole('button', { name: /^reagendar$/i }))
    fireEvent.click(screen.getByRole('combobox', { name: /novo horário/i }))
    fireEvent.click(screen.getByRole('option', { name: '10:00' }))
    fireEvent.click(screen.getByRole('button', { name: /confirmar novo horário/i }))

    expect(await screen.findByText(/conflito com agendamento existente/i)).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })
})

describe('AppointmentRow — reschedule omits busy slots (#1318)', () => {
  // Pin "today" so the panel's default date is deterministic and future slots
  // stay offerable. 2026-07-02 08:00 SP (11:00 UTC).
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-07-02T11:00:00.000Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('omits a start the professional is already busy in for the day', async () => {
    // Busy 10:00–10:30 SP (13:00–13:30 UTC) — a DIFFERENT appointment (not the
    // one being moved), so it must be filtered out of the picker.
    loadOwnRescheduleBusy.mockResolvedValue({
      ok: true,
      busy: [
        {
          id: 'other',
          memberOperationId: 'p1',
          startAt: '2026-07-02T13:00:00.000Z',
          endAt: '2026-07-02T13:30:00.000Z',
          status: 'scheduled',
        },
      ],
    })
    render(<AppointmentRow data={buildData()} />)

    fireEvent.click(screen.getByRole('button', { name: /^reagendar$/i }))
    // Wait for the busy fetch to land before reading the options.
    await waitFor(() => expect(loadOwnRescheduleBusy).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('combobox', { name: /novo horário/i }))

    await waitFor(() =>
      expect(screen.queryByRole('option', { name: '10:00' })).not.toBeInTheDocument(),
    )
    // Back-to-back neighbours stay bookable.
    expect(screen.getByRole('option', { name: '09:30' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '10:30' })).toBeInTheDocument()
  })

  it('keeps the slot when the only busy interval is the appointment itself', async () => {
    // The moved appointment (a1) reads back in its own busy window; excluding it
    // means its current 10:00 slot must still be offered.
    loadOwnRescheduleBusy.mockResolvedValue({
      ok: true,
      busy: [
        {
          id: 'a1',
          memberOperationId: 'p1',
          startAt: '2026-07-02T13:00:00.000Z',
          endAt: '2026-07-02T13:30:00.000Z',
          status: 'scheduled',
        },
      ],
    })
    render(<AppointmentRow data={buildData()} />)

    fireEvent.click(screen.getByRole('button', { name: /^reagendar$/i }))
    await waitFor(() => expect(loadOwnRescheduleBusy).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('combobox', { name: /novo horário/i }))

    expect(await screen.findByRole('option', { name: '10:00' })).toBeInTheDocument()
  })
})
