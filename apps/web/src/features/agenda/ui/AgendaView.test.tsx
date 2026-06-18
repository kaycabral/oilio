import type { HoursRange, Unit } from '@/domain'
import { EMPTY_ADDRESS, EMPTY_BUSINESS_HOURS } from '@/domain'
import type { updateAgendaSlotMinutes as updateAgendaSlotMinutesAction } from '@/features/agenda/adapters/agenda.actions'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgendaView } from './AgendaView'

type UpdateSlotResult = ReturnType<typeof updateAgendaSlotMinutesAction>

const mocks = vi.hoisted(() => ({
  updateAgendaSlotMinutes: vi.fn<(next: number) => UpdateSlotResult>(),
  routerPush: vi.fn(),
  routerRefresh: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))
const { updateAgendaSlotMinutes, routerPush, routerRefresh, toastSuccess, toastError } = mocks

vi.mock('@/features/agenda/adapters/agenda.actions', () => ({
  updateAgendaSlotMinutes: (next: number): UpdateSlotResult => mocks.updateAgendaSlotMinutes(next),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.routerPush, refresh: mocks.routerRefresh }),
}))

vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}))

// The grid contains pure presentation that we don't care to render in this
// test. Stub it to a marker so the AgendaView container shape is what's
// asserted.
vi.mock('./AgendaGrid', () => ({
  AgendaGrid: () => <div role="grid" aria-label="agenda-grid" />,
}))

vi.mock('./AppointmentDialog', () => ({
  AppointmentDialog: () => null,
}))

function buildUnit(id: string, name = `Unit ${id}`): Unit {
  return {
    id,
    orgId: 't1',
    name,
    slug: `unit-${id}`,
    whatsapp: '5511900000000',
    email: null,
    address: EMPTY_ADDRESS,
    businessHours: EMPTY_BUSINESS_HOURS,
    hoursMode: 'fixed',
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

const baseProps = {
  date: '2026-05-15',
  timezone: 'America/Sao_Paulo',
  slotMinutes: 15 as const,
  units: [buildUnit('u1')],
  activeUnitId: 'u1',
  professionals: [
    {
      id: 'p1',
      orgId: 't1',
      userId: 'u-pro1',
      name: 'Ana',
      whatsapp: '5511900000000',
      email: null,
      taxIdentity: null,
      operationalStatus: 'operational' as const,
      defaultCommission: null,
      unitIds: ['u1'],
      serviceIds: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  appointments: [],
  customersById: {},
  servicesById: {},
  dayHours: [{ open: '09:00', close: '18:00' }] as HoursRange[],
  blockSegments: [] as const,
  services: [],
  customers: [],
  businessName: 'Test Co',
  confirmationTemplate: '',
}

beforeEach(() => {
  updateAgendaSlotMinutes.mockReset()
  routerPush.mockReset()
  routerRefresh.mockReset()
  toastSuccess.mockReset()
  toastError.mockReset()
})

// The slot picker is the @cbrl/design Select (Radix). Drive it the canonical
// way — open the combobox, click the visible option — instead of firing a
// native `change` event (Radix is a button + portal, not a <select>).
function getSlotCombobox() {
  return screen.getByRole('combobox', { name: 'Slots' })
}

describe('AgendaView — slot granularity (#633, #746)', () => {
  it('renders the slot select for managers with the current slotMinutes selected', () => {
    render(<AgendaView {...baseProps} hasBusinessHours canManage />)
    expect(getSlotCombobox()).toHaveTextContent('15 min')
  })

  it('hides the slot select for non-managers (canManage=false)', () => {
    render(<AgendaView {...baseProps} hasBusinessHours canManage={false} />)
    expect(screen.queryByRole('combobox', { name: 'Slots' })).not.toBeInTheDocument()
  })

  it('calls updateAgendaSlotMinutes(next) when the manager picks a new value', async () => {
    const user = userEvent.setup()
    updateAgendaSlotMinutes.mockResolvedValue({ ok: true })
    render(<AgendaView {...baseProps} hasBusinessHours canManage />)
    await user.click(getSlotCombobox())
    await user.click(await screen.findByRole('option', { name: '30 min' }))
    await waitFor(() => expect(updateAgendaSlotMinutes).toHaveBeenCalledWith(30))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/30 min/)))
    expect(routerRefresh).toHaveBeenCalled()
  })

  it('does NOT call updateAgendaSlotMinutes when the same value is reselected', async () => {
    const user = userEvent.setup()
    render(<AgendaView {...baseProps} hasBusinessHours canManage />)
    await user.click(getSlotCombobox())
    // Re-pick the already-selected value: Radix short-circuits same-value
    // selection, so no spurious write / audit-log entry is triggered.
    await user.click(await screen.findByRole('option', { name: '15 min' }))
    expect(updateAgendaSlotMinutes).not.toHaveBeenCalled()
  })

  it('surfaces toast.error when the server returns { ok: false }', async () => {
    const user = userEvent.setup()
    updateAgendaSlotMinutes.mockResolvedValue({ ok: false, error: 'Granularidade inválida' })
    render(<AgendaView {...baseProps} hasBusinessHours canManage />)
    await user.click(getSlotCombobox())
    await user.click(await screen.findByRole('option', { name: '10 min' }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/inválida/i)))
    expect(routerRefresh).not.toHaveBeenCalled()
  })
})

describe('AgendaView — off-hours banner (#749)', () => {
  it('shows the off-hours banner when hasBusinessHours is false', () => {
    render(<AgendaView {...baseProps} hasBusinessHours={false} canManage />)
    expect(
      screen.getByText(/esta unidade ainda não tem horários de funcionamento/i),
    ).toBeInTheDocument()
    // Manager sees the deeplink to configure hours.
    expect(screen.getByRole('link', { name: /configurar horários/i })).toHaveAttribute(
      'href',
      '/units/u1',
    )
  })

  it('does NOT show the off-hours banner when hasBusinessHours is true', () => {
    render(<AgendaView {...baseProps} hasBusinessHours canManage />)
    expect(
      screen.queryByText(/esta unidade ainda não tem horários de funcionamento/i),
    ).not.toBeInTheDocument()
  })

  it('hides the "Configurar horários" link from non-managers (read-only banner)', () => {
    render(<AgendaView {...baseProps} hasBusinessHours={false} canManage={false} />)
    expect(
      screen.getByText(/esta unidade ainda não tem horários de funcionamento/i),
    ).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /configurar horários/i })).not.toBeInTheDocument()
  })

  it('does not show the off-hours banner when there is no active unit', () => {
    render(
      <AgendaView
        {...baseProps}
        activeUnitId={null}
        units={[]}
        hasBusinessHours={false}
        canManage
      />,
    )
    expect(
      screen.queryByText(/esta unidade ainda não tem horários de funcionamento/i),
    ).not.toBeInTheDocument()
  })
})
