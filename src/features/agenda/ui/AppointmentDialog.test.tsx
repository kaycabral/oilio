import type { Appointment, CatalogServiceItem, Customer, MemberOperation } from '@/domain'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppointmentDialog } from './AppointmentDialog'

type ActionResult = { ok: true; appointmentId?: string } | { ok: false; error: string }
type CreateAction = (formData: FormData) => Promise<ActionResult>
type UpdateAction = (id: string, formData: FormData) => Promise<ActionResult>
type FormAction = (prevState: unknown, formData: FormData) => Promise<ActionResult>

const mocks = vi.hoisted(() => ({
  createAppointment: vi.fn<CreateAction>(),
  updateAppointment: vi.fn<UpdateAction>(),
  cancelAppointmentFormAction: vi.fn<FormAction>(),
  markAppointmentNoShowFormAction: vi.fn<FormAction>(),
  unmarkAppointmentNoShowFormAction: vi.fn<FormAction>(),
  startAttendanceFormAction: vi.fn<FormAction>(),
  routerPush: vi.fn(),
  routerRefresh: vi.fn(),
}))

vi.mock('@/features/agenda/adapters/agenda.actions', () => ({
  createAppointment: mocks.createAppointment,
  updateAppointment: mocks.updateAppointment,
  cancelAppointmentFormAction: mocks.cancelAppointmentFormAction,
  markAppointmentNoShowFormAction: mocks.markAppointmentNoShowFormAction,
  unmarkAppointmentNoShowFormAction: mocks.unmarkAppointmentNoShowFormAction,
}))

vi.mock('@/features/orders/adapters/orders.actions', () => ({
  startAttendanceFormAction: mocks.startAttendanceFormAction,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.routerPush, refresh: mocks.routerRefresh }),
}))

function buildMemberOperation(): MemberOperation {
  return {
    id: 'p1',
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
}
function buildService(): CatalogServiceItem {
  return {
    id: 's1',
    orgId: 't1',
    kind: 'service',
    name: 'Corte',
    categoryId: null,
    durationMinutes: 30,
    priceCents: 4000,
    commission: null,
    requiredResources: [],
    active: true,
    publicVisible: false,
    priceVisibility: 'visible',
    unitIds: ['u1'],
    unitOverrides: null,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}
function buildCustomer(): Customer {
  return {
    id: 'c1',
    orgId: 't1',
    userId: 'u1',
    name: 'João',
    mobile: '5511999999999',
    birthDate: null,
    avatarUrl: null,
    archivedAt: null,
    deactivatedAt: null,
    acquisition: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}
function buildAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'a1',
    orgId: 't1',
    unitId: 'u1',
    memberOperationId: 'p1',
    customerId: 'c1',
    serviceId: 's1',
    startAt: '2026-05-15T13:00:00.000Z',
    endAt: '2026-05-15T13:30:00.000Z',
    status: 'scheduled',
    servicePriceCentsSnapshot: 4000,
    serviceDurationMinutesSnapshot: 30,
    commissionSnapshot: null,
    cancellationPolicySnapshot: null,
    customerUserId: 'u1',
    memberOperatorUserId: null,
    attribution: null,
    createdAt: '2026-05-15T12:00:00.000Z',
    updatedAt: '2026-05-15T12:00:00.000Z',
    ...overrides,
  }
}

function makeBaseProps() {
  return {
    open: true,
    onOpenChange: vi.fn(),
    unitId: 'u1',
    memberOperations: [buildMemberOperation()],
    services: [buildService()],
    customers: [buildCustomer()],
    date: '2026-05-15',
    timezone: 'America/Sao_Paulo',
    appointmentGrid: {
      slotMinutes: 30 as const,
      businessHours: {
        monday: { open: '09:00', close: '12:00' },
        tuesday: { open: '09:00', close: '12:00' },
        wednesday: { open: '09:00', close: '12:00' },
        thursday: { open: '09:00', close: '12:00' },
        friday: { open: '09:00', close: '12:00' },
        saturday: null,
        sunday: null,
      },
    },
    businessName: 'Test',
    confirmationTemplate: '',
  }
}

function assertCalledWithAppointmentId(
  mock: ReturnType<typeof vi.fn<FormAction>>,
  appointmentId: string,
): void {
  expect(mock).toHaveBeenCalled()
  const lastCall = mock.mock.calls[mock.mock.calls.length - 1]!
  const formData = lastCall[1]
  expect(formData.get('appointmentId')).toBe(appointmentId)
}

beforeEach(() => {
  mocks.createAppointment.mockReset()
  mocks.updateAppointment.mockReset()
  mocks.cancelAppointmentFormAction.mockReset()
  mocks.markAppointmentNoShowFormAction.mockReset()
  mocks.unmarkAppointmentNoShowFormAction.mockReset()
  mocks.startAttendanceFormAction.mockReset()
  mocks.routerPush.mockReset()
  mocks.routerRefresh.mockReset()
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date('2026-05-15T11:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('AppointmentDialog — cancel flow (#639)', () => {
  it('shows the cancel-confirmation step before calling the cancel action', () => {
    const baseProps = makeBaseProps()
    render(<AppointmentDialog {...baseProps} appointment={buildAppointment()} />)
    fireEvent.click(screen.getByRole('button', { name: /^cancelar agendamento$/i }))
    expect(screen.getByText(/cancelar mesmo\?/i)).toBeInTheDocument()
    expect(mocks.cancelAppointmentFormAction).not.toHaveBeenCalled()
  })

  it('dispatches the cancel form with the appointment id after confirming', async () => {
    mocks.cancelAppointmentFormAction.mockResolvedValue({ ok: true })
    const baseProps = makeBaseProps()
    render(<AppointmentDialog {...baseProps} appointment={buildAppointment()} />)
    fireEvent.click(screen.getByRole('button', { name: /^cancelar agendamento$/i }))
    fireEvent.click(screen.getByRole('button', { name: /^sim$/i }))
    await waitFor(() => assertCalledWithAppointmentId(mocks.cancelAppointmentFormAction, 'a1'))
    await waitFor(() => expect(baseProps.onOpenChange).toHaveBeenCalledWith(false))
  })

  it('surfaces the server error on failure', async () => {
    mocks.cancelAppointmentFormAction.mockResolvedValue({
      ok: false,
      error: 'Agendamento já está cancelado',
    })
    const baseProps = makeBaseProps()
    render(<AppointmentDialog {...baseProps} appointment={buildAppointment()} />)
    fireEvent.click(screen.getByRole('button', { name: /^cancelar agendamento$/i }))
    fireEvent.click(screen.getByRole('button', { name: /^sim$/i }))
    expect(await screen.findByText(/agendamento já está cancelado/i)).toBeInTheDocument()
  })

  it('does not render the cancel button for already-cancelled appointments', () => {
    const baseProps = makeBaseProps()
    render(
      <AppointmentDialog {...baseProps} appointment={buildAppointment({ status: 'cancelled' })} />,
    )
    expect(
      screen.queryByRole('button', { name: /^cancelar agendamento$/i }),
    ).not.toBeInTheDocument()
  })
})

describe('AppointmentDialog — reschedule (#639)', () => {
  it('calls updateAppointment with the appointment id on submit (edit mode)', async () => {
    mocks.updateAppointment.mockResolvedValue({ ok: true, appointmentId: 'a1' })
    const baseProps = makeBaseProps()
    render(<AppointmentDialog {...baseProps} appointment={buildAppointment()} />)

    fireEvent.click(screen.getByRole('combobox', { name: /início/i }))
    fireEvent.click(screen.getByRole('option', { name: '11:00' }))

    fireEvent.click(screen.getByRole('button', { name: /^salvar$/i }))
    await waitFor(() => expect(mocks.updateAppointment).toHaveBeenCalledTimes(1))
    const [id, fd] = mocks.updateAppointment.mock.calls[0]!
    expect(id).toBe('a1')
    expect(fd.get('startTime')).toBe('11:00')
    expect(fd.get('serviceId')).toBe('s1')
    expect(fd.get('memberOperationId')).toBe('p1')
    expect(mocks.createAppointment).not.toHaveBeenCalled()
  })

  it('surfaces the server error when updateAppointment fails (conflict)', async () => {
    mocks.updateAppointment.mockResolvedValue({
      ok: false,
      error: 'Conflito com outro agendamento',
    })
    const baseProps = makeBaseProps()
    render(<AppointmentDialog {...baseProps} appointment={buildAppointment()} />)
    const saveButton = screen.getByRole('button', { name: /^salvar$/i })
    const form = saveButton instanceof HTMLButtonElement ? saveButton.form : null
    expect(form).not.toBeNull()
    fireEvent.submit(form ?? saveButton)
    expect(await screen.findByText(/conflito com outro agendamento/i)).toBeInTheDocument()
    expect(mocks.updateAppointment).toHaveBeenCalledTimes(1)
    expect(baseProps.onOpenChange).not.toHaveBeenCalled()
  })
})

describe('AppointmentDialog — past-slot preselection (#1314)', () => {
  it('NEW after 09:00 does not offer or preselect a past slot; default is the first future slot', () => {
    vi.setSystemTime(new Date('2026-05-15T13:00:00.000Z'))
    const baseProps = makeBaseProps()
    render(<AppointmentDialog {...baseProps} appointment={null} />)
    const combobox = screen.getByRole('combobox', { name: /início/i })
    expect(combobox).toHaveTextContent('10:00')
    expect(combobox).not.toHaveTextContent('09:00')
    fireEvent.click(combobox)
    expect(screen.queryByRole('option', { name: '09:00' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: '09:30' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: '10:00' })).toBeInTheDocument()
  })

  it('EDIT preserves the appointment start even when it fell off the grid', () => {
    vi.setSystemTime(new Date('2026-05-15T10:00:00.000Z'))
    const baseProps = makeBaseProps()
    render(
      <AppointmentDialog
        {...baseProps}
        appointment={buildAppointment({
          startAt: '2026-05-15T11:00:00.000Z',
          endAt: '2026-05-15T11:30:00.000Z',
        })}
      />,
    )
    fireEvent.click(screen.getByRole('combobox', { name: /início/i }))
    expect(screen.getByRole('option', { name: '08:00' })).toBeInTheDocument()
  })
})

describe('AppointmentDialog — omit already-busy slots (#1318)', () => {
  const busyAt10 = {
    p1: [
      buildAppointment({
        id: 'other',
        startAt: '2026-05-15T13:00:00.000Z',
        endAt: '2026-05-15T13:30:00.000Z',
      }),
    ],
  }

  it('NEW does not offer a slot the selected professional is already busy in', () => {
    vi.setSystemTime(new Date('2026-05-15T11:00:00.000Z'))
    const baseProps = makeBaseProps()
    render(<AppointmentDialog {...baseProps} appointment={null} busyByMemberOperation={busyAt10} />)
    fireEvent.click(screen.getByRole('combobox', { name: /profissional/i }))
    fireEvent.click(screen.getByRole('option', { name: 'Ana' }))
    fireEvent.click(screen.getByRole('combobox', { name: /início/i }))
    expect(screen.queryByRole('option', { name: '10:00' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: '09:30' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '10:30' })).toBeInTheDocument()
  })

  it('EDIT keeps the appointment its own slot (excludeAppointmentId)', () => {
    vi.setSystemTime(new Date('2026-05-15T11:00:00.000Z'))
    const baseProps = makeBaseProps()
    const own = {
      p1: [
        buildAppointment({
          id: 'a1',
          startAt: '2026-05-15T13:00:00.000Z',
          endAt: '2026-05-15T13:30:00.000Z',
        }),
      ],
    }
    render(
      <AppointmentDialog
        {...baseProps}
        appointment={buildAppointment({
          startAt: '2026-05-15T13:00:00.000Z',
          endAt: '2026-05-15T13:30:00.000Z',
        })}
        busyByMemberOperation={own}
      />,
    )
    fireEvent.click(screen.getByRole('combobox', { name: /início/i }))
    expect(screen.getByRole('option', { name: '10:00' })).toBeInTheDocument()
  })

  it('offers every slot when the professional has no busy interval', () => {
    vi.setSystemTime(new Date('2026-05-15T11:00:00.000Z'))
    const baseProps = makeBaseProps()
    render(<AppointmentDialog {...baseProps} appointment={null} busyByMemberOperation={{}} />)
    fireEvent.click(screen.getByRole('combobox', { name: /profissional/i }))
    fireEvent.click(screen.getByRole('option', { name: 'Ana' }))
    fireEvent.click(screen.getByRole('combobox', { name: /início/i }))
    expect(screen.getByRole('option', { name: '10:00' })).toBeInTheDocument()
  })
})

describe('AppointmentDialog — no-show flow (#871)', () => {
  const PAST_START = '2020-01-01T13:00:00.000Z'
  const FUTURE_START = '2099-01-01T13:00:00.000Z'

  it('hides "Marcar não compareceu" before scheduledStartAt', () => {
    const baseProps = makeBaseProps()
    render(
      <AppointmentDialog
        {...baseProps}
        appointment={buildAppointment({ startAt: FUTURE_START, endAt: FUTURE_START })}
      />,
    )
    expect(
      screen.queryByRole('button', { name: /^marcar não compareceu$/i }),
    ).not.toBeInTheDocument()
  })

  it('shows "Marcar não compareceu" after scheduledStartAt for a scheduled appointment', () => {
    const baseProps = makeBaseProps()
    render(
      <AppointmentDialog
        {...baseProps}
        appointment={buildAppointment({ startAt: PAST_START, endAt: PAST_START })}
      />,
    )
    expect(screen.getByRole('button', { name: /^marcar não compareceu$/i })).toBeInTheDocument()
  })

  it('dispatches the no-show form with the appointment id and closes on success', async () => {
    mocks.markAppointmentNoShowFormAction.mockResolvedValue({ ok: true })
    const baseProps = makeBaseProps()
    render(
      <AppointmentDialog
        {...baseProps}
        appointment={buildAppointment({ startAt: PAST_START, endAt: PAST_START })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /^marcar não compareceu$/i }))
    await waitFor(() => assertCalledWithAppointmentId(mocks.markAppointmentNoShowFormAction, 'a1'))
    await waitFor(() => expect(baseProps.onOpenChange).toHaveBeenCalledWith(false))
  })

  it('shows only "Desmarcar não compareceu" when status is no_show', () => {
    const baseProps = makeBaseProps()
    render(
      <AppointmentDialog
        {...baseProps}
        appointment={buildAppointment({
          startAt: PAST_START,
          endAt: PAST_START,
          status: 'no_show',
        })}
      />,
    )
    expect(screen.getByRole('button', { name: /^desmarcar não compareceu$/i })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /^marcar não compareceu$/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /^cancelar agendamento$/i }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /iniciar atendimento/i })).not.toBeInTheDocument()
  })

  it('surfaces server error on unmark failure (dialog stays open)', async () => {
    mocks.unmarkAppointmentNoShowFormAction.mockResolvedValue({
      ok: false,
      error: 'Agendamento não está marcado como não compareceu',
    })
    const baseProps = makeBaseProps()
    render(
      <AppointmentDialog
        {...baseProps}
        appointment={buildAppointment({
          startAt: PAST_START,
          endAt: PAST_START,
          status: 'no_show',
        })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /^desmarcar não compareceu$/i }))
    expect(await screen.findByText(/não está marcado como não compareceu/i)).toBeInTheDocument()
    assertCalledWithAppointmentId(mocks.unmarkAppointmentNoShowFormAction, 'a1')
    expect(baseProps.onOpenChange).not.toHaveBeenCalled()
  })
})
