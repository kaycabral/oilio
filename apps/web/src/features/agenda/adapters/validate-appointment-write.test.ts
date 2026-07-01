import { beforeEach, describe, expect, it, vi } from 'vitest'

// The single validation layer composes three adapters; mock each at its module
// boundary so the test asserts the ORDER + short-circuit (brief 0080, Grupo B)
// without I/O. `server-only` is a no-op stub under vitest.
const mocks = vi.hoisted(() => ({
  enforceSlotGrid: vi.fn(),
  checkSlotConflicts: vi.fn(),
  enforceSubscriptionScope: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/features/booking/adapters/enforce-slot-grid', () => ({
  enforceSlotGrid: mocks.enforceSlotGrid,
}))
vi.mock('@/features/booking/adapters/enforce-subscription-scope', () => ({
  enforceSubscriptionScope: mocks.enforceSubscriptionScope,
}))
vi.mock('./appointment-write-helpers', () => ({
  checkSlotConflicts: mocks.checkSlotConflicts,
}))

import { validateAppointmentWrite } from './validate-appointment-write'

type WriteArgs = Parameters<typeof validateAppointmentWrite>[0]

// The layer only reads id/timezone/agenda.mode off the unit; the slot-grid +
// scope checks it delegates to are mocked, so a minimal appointment-mode stub
// is enough. Typed via the param type so no cast is needed.
const UNIT: WriteArgs['unit'] = {
  id: 'u1',
  timezone: 'America/Sao_Paulo',
  agenda: {
    mode: 'appointment',
    businessHours: {
      monday: null,
      tuesday: null,
      wednesday: null,
      thursday: null,
      friday: null,
      saturday: null,
      sunday: null,
    },
    slotMinutes: 30,
    cancellationPolicy: { enabled: false, minNoticeMinutes: 120 },
    confirmationTemplates: { confirmation: '', reminder: '', cancellation: '' },
  },
}

function callArgs(): WriteArgs {
  return {
    orgId: 't1',
    unit: UNIT,
    userId: 'actor',
    surface: 'reception' as const,
    parsed: {
      unitId: 'u1',
      memberOperationId: 'p1',
      serviceId: 's1',
      date: '2026-07-06',
      startTime: '10:00',
    },
    startAt: '2026-07-06T13:00:00.000Z',
    endAt: '2026-07-06T13:30:00.000Z',
    customerId: 'c1',
    serviceCategoryId: null,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.enforceSlotGrid.mockReturnValue({ ok: true })
  mocks.checkSlotConflicts.mockResolvedValue(null)
  mocks.enforceSubscriptionScope.mockResolvedValue({ ok: true })
})

describe('validateAppointmentWrite', () => {
  it('passes when all three checks pass', async () => {
    const result = await validateAppointmentWrite(callArgs())
    expect(result.ok).toBe(true)
    expect(mocks.enforceSlotGrid).toHaveBeenCalledTimes(1)
    expect(mocks.checkSlotConflicts).toHaveBeenCalledTimes(1)
    expect(mocks.enforceSubscriptionScope).toHaveBeenCalledTimes(1)
  })

  it('rejects off-grid first — overlap and scope never run', async () => {
    mocks.enforceSlotGrid.mockReturnValue({ ok: false, error: 'off grid' })
    const result = await validateAppointmentWrite(callArgs())
    expect(result).toEqual({ ok: false, error: 'off grid' })
    expect(mocks.checkSlotConflicts).not.toHaveBeenCalled()
    expect(mocks.enforceSubscriptionScope).not.toHaveBeenCalled()
  })

  it('rejects on overlap before scope, surfacing the conflict labels', async () => {
    mocks.checkSlotConflicts.mockResolvedValue({
      error: 'Conflito com agendamento existente',
      conflicts: ['agendamento existente'],
    })
    const result = await validateAppointmentWrite(callArgs())
    expect(result).toEqual({
      ok: false,
      error: 'Conflito com agendamento existente',
      conflicts: ['agendamento existente'],
    })
    expect(mocks.enforceSubscriptionScope).not.toHaveBeenCalled()
  })

  it('rejects on subscription scope last', async () => {
    mocks.enforceSubscriptionScope.mockResolvedValue({ ok: false, error: 'fora do plano' })
    const result = await validateAppointmentWrite(callArgs())
    expect(result).toEqual({ ok: false, error: 'fora do plano' })
  })

  it('forwards excludeAppointmentId to overlap + scope on an edit', async () => {
    await validateAppointmentWrite({ ...callArgs(), excludeAppointmentId: 'a1' })
    expect(mocks.checkSlotConflicts).toHaveBeenCalledWith(
      expect.objectContaining({ excludeAppointmentId: 'a1' }),
    )
    expect(mocks.enforceSubscriptionScope).toHaveBeenCalledWith(
      expect.objectContaining({ excludeAppointmentId: 'a1' }),
    )
  })
})
