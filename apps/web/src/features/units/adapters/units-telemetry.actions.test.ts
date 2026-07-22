import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireManagerCtx: vi.fn(),
  track: vi.fn(),
}))

vi.mock('@/shared/org/membership', () => ({
  requireManagerCtx: mocks.requireManagerCtx,
  requireOwnerCtx: vi.fn(),
}))
vi.mock('@/shared/lib/track', () => ({ track: mocks.track }))
vi.mock('@/shared/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn() } }))
vi.mock('@/shared/billing/stripe-sync', () => ({ syncStripeSubscriptionQuantity: vi.fn() }))
vi.mock('@/shared/billing/unit-cost-preview', () => ({ getUnitAdditionCost: vi.fn() }))
vi.mock('@/shared/db/effect/catalog-item-read', () => ({ listCatalogItems: vi.fn() }))
vi.mock('@/shared/db/pg/effect/postgres-layer', () => ({ deletePostgresProjection: vi.fn() }))
vi.mock('@/shared/db/pg/fk-violation', () => ({ isForeignKeyViolation: vi.fn() }))
vi.mock('@/shared/db/pg/new-id', () => ({ newId: vi.fn() }))
vi.mock('@/shared/effect-bridge', () => ({ emitEvent: vi.fn() }))
vi.mock('@/shared/errors/classify', () => ({ classifyError: vi.fn() }))
vi.mock('@/shared/errors/messages', () => ({ messageForCategory: vi.fn() }))
vi.mock('@/shared/org/delete-guard', () => ({ canDeleteUnit: vi.fn() }))
vi.mock('@/shared/org/member-operation-read', () => ({
  hasOperationalMemberOperationInUnit: vi.fn(),
}))
vi.mock('@/shared/org/unit-read', () => ({
  deleteUnitPii: vi.fn(),
  getUnitById: vi.fn(),
  listUnitSlugs: vi.fn(),
  writeUnitPii: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))

import { trackUnitWizardEvent } from './units.actions'

function managerCtx() {
  return {
    ok: true as const,
    ctx: {
      session: { uid: 'user-1' },
      membership: { orgId: 'org-1', role: 'manager' as const, userId: 'user-1' },
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('trackUnitWizardEvent (AC-21, PII-zero)', () => {
  it('emits unit_wizard_opened with org/user ids from the server context only', async () => {
    mocks.requireManagerCtx.mockResolvedValue(managerCtx())
    await trackUnitWizardEvent({ event: 'opened' })
    expect(mocks.track).toHaveBeenCalledWith('unit_wizard_opened', {
      org_id: 'org-1',
      user_id: 'user-1',
    })
  })

  it('emits step_completed with step and mode', async () => {
    mocks.requireManagerCtx.mockResolvedValue(managerCtx())
    await trackUnitWizardEvent({ event: 'step_completed', step: 'hours', mode: 'appointment' })
    expect(mocks.track).toHaveBeenCalledWith('unit_wizard_step_completed', {
      org_id: 'org-1',
      user_id: 'user-1',
      step: 'hours',
      mode: 'appointment',
    })
  })

  it('emits abandoned with last_step', async () => {
    mocks.requireManagerCtx.mockResolvedValue(managerCtx())
    await trackUnitWizardEvent({ event: 'abandoned', lastStep: 'address' })
    expect(mocks.track).toHaveBeenCalledWith('unit_wizard_abandoned', {
      org_id: 'org-1',
      user_id: 'user-1',
      last_step: 'address',
    })
  })

  it('emits cost_acknowledged', async () => {
    mocks.requireManagerCtx.mockResolvedValue(managerCtx())
    await trackUnitWizardEvent({ event: 'cost_acknowledged' })
    expect(mocks.track).toHaveBeenCalledWith('unit_wizard_cost_acknowledged', {
      org_id: 'org-1',
      user_id: 'user-1',
    })
  })

  it('drops the event silently without a manager context', async () => {
    mocks.requireManagerCtx.mockResolvedValue({ ok: false, error: 'denied' })
    await trackUnitWizardEvent({ event: 'opened' })
    expect(mocks.track).not.toHaveBeenCalled()
  })

  it('never carries free-text or PII properties — payload keys are a closed set', async () => {
    mocks.requireManagerCtx.mockResolvedValue(managerCtx())
    await trackUnitWizardEvent({ event: 'step_completed', step: 'identity', mode: null })
    const call: unknown[] = mocks.track.mock.calls[0] ?? []
    const props = call[1]
    if (typeof props !== 'object' || props === null) throw new Error('missing track props')
    expect(Object.keys(props).sort()).toEqual(['mode', 'org_id', 'step', 'user_id'])
  })
})
