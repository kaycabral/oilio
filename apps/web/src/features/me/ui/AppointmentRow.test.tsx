import { DEFAULT_CANCELLATION_POLICY } from '@/domain'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppointmentRow, type AppointmentRowData } from './AppointmentRow'

// `rescheduleOwnAppointment` is the server action the panel calls. Stub it at
// that boundary; `useRouter().refresh` is the contract the fix relies on — a
// successful reschedule must refresh so the Server Component re-renders with the
// new (server-projected) start/end labels instead of a stale "atualize a
// página" banner showing the old time (#B9).
const rescheduleOwnAppointment = vi.fn()
const cancelOwnAppointment = vi.fn()
const refresh = vi.fn()

vi.mock('@/features/me/adapters/appointments.actions', () => ({
  rescheduleOwnAppointment: (args: unknown): unknown => rescheduleOwnAppointment(args),
  cancelOwnAppointment: (args: unknown): unknown => cancelOwnAppointment(args),
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
