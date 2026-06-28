import type { HoursRange, MemberOperation, Unit } from '@/domain'
import { EMPTY_ADDRESS, EMPTY_BUSINESS_HOURS } from '@/domain'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgendaView } from './AgendaView'

const mocks = vi.hoisted(() => ({
  routerPush: vi.fn(),
  routerRefresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.routerPush, refresh: mocks.routerRefresh }),
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
    timezone: 'America/Sao_Paulo',
    agenda: { mode: 'fixed', businessHours: EMPTY_BUSINESS_HOURS },
    archivedAt: null,
    fiscal: { kind: 'informal' },
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
  // The agenda only ever receives bookable memberOperations (operational + a
  // CURRENTLY active membership carrying `canBeBooked`) —
  // `listBookableMemberOperationsForOrg` applies that filter. Plain `MemberOperation`
  // since brief 0076 retired the `BookableProfessional` brand (AC-03).
  memberOperations: [
    {
      id: 'p1',
      orgId: 't1',
      userId: 'u-pro1',
      name: 'Ana',
      whatsapp: '5511900000000',
      email: null,
      taxIdentity: null,
      operationalStatus: 'operational',
      defaultCommission: null,
      unitIds: ['u1'],
      catalogServiceIds: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } satisfies MemberOperation,
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
  selfMemberOperationId: null,
  canManageCustomers: true,
  memberOperationMissing: false,
}

beforeEach(() => {
  mocks.routerPush.mockReset()
  mocks.routerRefresh.mockReset()
})

// The slot-granularity control was removed from the agenda (#633/#746 reverted):
// slot size is now configured ONLY in the unit's hours settings. So this file
// no longer covers a slot picker — it covers the off-hours banner gating.

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

// #1268: a self-scoped member whose operational profile isn't provisioned yet
// resolves to the fail-closed sentinel scope; `load-agenda` skips the reads and
// flags `memberOperationMissing`. The grid must NOT read as data loss — an
// explicit, actionable empty-state carries the reason instead.
describe('AgendaView — missing operational profile empty-state (#1268)', () => {
  it('renders the explicit empty-state instead of the (empty) grid', () => {
    render(<AgendaView {...baseProps} hasBusinessHours memberOperationMissing canManage={false} />)
    expect(screen.getByText(/seu perfil de agenda ainda não está pronto/i)).toBeInTheDocument()
    // The grid is suppressed — no mute blank surface.
    expect(screen.queryByRole('grid', { name: 'agenda-grid' })).not.toBeInTheDocument()
  })

  it('offers a refresh action that re-fetches the route (projection lag recovery)', () => {
    render(<AgendaView {...baseProps} hasBusinessHours memberOperationMissing canManage={false} />)
    fireEvent.click(screen.getByRole('button', { name: /atualizar/i }))
    expect(mocks.routerRefresh).toHaveBeenCalledTimes(1)
  })

  it('shows the grid normally when the profile IS provisioned', () => {
    render(
      <AgendaView
        {...baseProps}
        hasBusinessHours
        memberOperationMissing={false}
        canManage={false}
      />,
    )
    expect(
      screen.queryByText(/seu perfil de agenda ainda não está pronto/i),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('grid', { name: 'agenda-grid' })).toBeInTheDocument()
  })
})
