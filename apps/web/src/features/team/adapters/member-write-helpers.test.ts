// Unit tests for `resolveProfessionalRoleStep` (#1199 / #1226 AC-02) — the pure
// decision the Postgres change-role saga turns into a step. `getProfessionalByUserId`
// is mocked (no DB); the create branch mints a fresh professional id via `newId`
// (a real UUID — no mock needed). Since `operationalStatus` is now derived on read
// (#1226 AC-02), a role change no longer emits `professional.activated`/`.suspended`:
// the only write is MATERIALIZING a new projection on first promotion. Covers all
// branches: promote-no-existing → create, promote-with-existing → none,
// demote → none, non-professional → none.

import type { Professional } from '@/domain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getProfessionalByUserId: vi.fn(),
}))
vi.mock('@/shared/org/professional-read', () => ({
  getProfessionalById: vi.fn(),
  getProfessionalByUserId: mocks.getProfessionalByUserId,
  // unused by the resolver but imported by the module under test:
  writeProfessionalPii: vi.fn(),
  deleteProfessionalPii: vi.fn(),
}))

import { resolveProfessionalRoleStep } from './member-write-helpers'

function pro(overrides: Partial<Professional> = {}): Professional {
  return {
    id: 'pro-1',
    orgId: 'org-1',
    userId: 'user-1',
    name: 'Zé',
    whatsapp: '5511999999999',
    email: null,
    taxIdentity: null,
    operationalStatus: 'incomplete',
    defaultCommission: null,
    unitIds: ['unit-1'],
    catalogServiceIds: ['svc-1'],
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  }
}

const base = {
  orgId: 'org-1',
  actorId: 'actor',
  targetUserId: 'user-1',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resolveProfessionalRoleStep', () => {
  it('promotion with NO existing projection → create', async () => {
    mocks.getProfessionalByUserId.mockResolvedValue(null)
    const step = await resolveProfessionalRoleStep({
      ...base,
      willBeProfessional: true,
    })
    expect(step.kind).toBe('create')
    if (step.kind === 'create') {
      expect(step.input._tag).toBe('professional.created')
      expect(step.path).toContain('/professionals/')
    }
  })

  it('re-promotion WITH an existing projection → none (readiness is derived on read)', async () => {
    // A projection already exists — nothing to materialize, and there is no
    // activation event to emit anymore (status is derived on read).
    mocks.getProfessionalByUserId.mockResolvedValue(pro({ operationalStatus: 'incomplete' }))
    const step = await resolveProfessionalRoleStep({
      ...base,
      willBeProfessional: true,
    })
    expect(step.kind).toBe('none')
  })

  it('re-promotion of an already-operational pro → none', async () => {
    mocks.getProfessionalByUserId.mockResolvedValue(pro({ operationalStatus: 'operational' }))
    const step = await resolveProfessionalRoleStep({
      ...base,
      willBeProfessional: true,
    })
    expect(step.kind).toBe('none')
  })

  it('demotion (will not be professional) → none (no suspend event; offboarding severs operability)', async () => {
    mocks.getProfessionalByUserId.mockResolvedValue(pro({ operationalStatus: 'operational' }))
    const step = await resolveProfessionalRoleStep({
      ...base,
      willBeProfessional: false,
    })
    expect(step.kind).toBe('none')
    // The resolver short-circuits on `!willBeProfessional` — no projection read.
    expect(mocks.getProfessionalByUserId).not.toHaveBeenCalled()
  })

  it('non-professional role change (no projection) → none', async () => {
    mocks.getProfessionalByUserId.mockResolvedValue(null)
    const step = await resolveProfessionalRoleStep({
      ...base,
      willBeProfessional: false,
    })
    expect(step.kind).toBe('none')
  })
})
