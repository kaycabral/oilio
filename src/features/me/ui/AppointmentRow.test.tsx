import { DEFAULT_CANCELLATION_POLICY } from '@/domain'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppointmentRow, type AppointmentRowData } from './AppointmentRow'

const rescheduleOwnAppointment = vi.fn()
const cancelOwnAppointment = vi.fn()
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
  loadOwnRescheduleBusy.mockResolvedValue({ ok: true, busy: [] })
  refresh.mockReset()
})

describe('AppointmentRow — reschedule refreshes the row (#B9)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-07-02T11:00:00.000Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('refreshes the server view on a successful reschedule (no stale banner)', async () => {
    rescheduleOwnAppointment.mockResolvedValue({ ok: true })
    render(<AppointmentRow data={buildData()} />)

    fireEvent.click(screen.getByRole('button', { name: /^reagendar$/i }))
    fireEvent.click(screen.getByRole('combobox', { name: /novo horário/i }))
    fireEvent.click(screen.getByRole('option', { name: '10:00' }))
    fireEvent.click(screen.getByRole('button', { name: /confirmar novo horário/i }))

    await waitFor(() => expect(rescheduleOwnAppointment).toHaveBeenCalledTimes(1))
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
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-07-02T11:00:00.000Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('omits a start the professional is already busy in for the day', async () => {
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
    await waitFor(() => expect(loadOwnRescheduleBusy).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('combobox', { name: /novo horário/i }))

    await waitFor(() =>
      expect(screen.queryByRole('option', { name: '10:00' })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('option', { name: '09:30' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '10:30' })).toBeInTheDocument()
  })

  it('keeps the slot when the only busy interval is the appointment itself', async () => {
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
