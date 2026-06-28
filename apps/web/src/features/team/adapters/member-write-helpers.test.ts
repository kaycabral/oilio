// Unit tests for `resolveMemberOperatorRoleStep` (#1199 / #1226 AC-02) — the pure
// decision the Postgres change-role saga turns into a step. `getMemberOperationByUserId`
// is mocked (no DB); the create branch mints a fresh memberOperation id via `newId`
// (a real UUID — no mock needed). Since `operationalStatus` is now derived on read
// (#1226 AC-02), a role change no longer emits `member_operation.activated`/`.suspended`:
// the only write is MATERIALIZING a new projection on first promotion. Covers all
// branches: promote-no-existing → create, promote-with-existing → none,
// demote → none, non-memberOperation → none.

import type { MemberOperation } from '@/domain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getMemberOperationByUserId: vi.fn(),
}))
vi.mock('@/shared/org/member-operation-read', () => ({
  getMemberOperationById: vi.fn(),
  getMemberOperationByUserId: mocks.getMemberOperationByUserId,
  // unused by the resolver but imported by the module under test:
  writeMemberOperationPii: vi.fn(),
  deleteMemberOperationPii: vi.fn(),
}))

import { resolveMemberOperatorRoleStep } from './member-write-helpers'

function pro(overrides: Partial<MemberOperation> = {}): MemberOperation {
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

describe('resolveMemberOperatorRoleStep', () => {
  it('promotion with NO existing projection → create', async () => {
    mocks.getMemberOperationByUserId.mockResolvedValue(null)
    const step = await resolveMemberOperatorRoleStep({
      ...base,
      willBeMemberOperator: true,
    })
    expect(step.kind).toBe('create')
    if (step.kind === 'create') {
      expect(step.input._tag).toBe('member_operation.created')
      expect(step.path).toContain('/memberOperations/')
    }
  })

  it('re-promotion WITH an existing projection → none (readiness is derived on read)', async () => {
    // A projection already exists — nothing to materialize, and there is no
    // activation event to emit anymore (status is derived on read).
    mocks.getMemberOperationByUserId.mockResolvedValue(pro({ operationalStatus: 'incomplete' }))
    const step = await resolveMemberOperatorRoleStep({
      ...base,
      willBeMemberOperator: true,
    })
    expect(step.kind).toBe('none')
  })

  it('re-promotion of an already-operational pro → none', async () => {
    mocks.getMemberOperationByUserId.mockResolvedValue(pro({ operationalStatus: 'operational' }))
    const step = await resolveMemberOperatorRoleStep({
      ...base,
      willBeMemberOperator: true,
    })
    expect(step.kind).toBe('none')
  })

  it('demotion (will not be memberOperation) → none (no suspend event; offboarding severs operability)', async () => {
    mocks.getMemberOperationByUserId.mockResolvedValue(pro({ operationalStatus: 'operational' }))
    const step = await resolveMemberOperatorRoleStep({
      ...base,
      willBeMemberOperator: false,
    })
    expect(step.kind).toBe('none')
    // The resolver short-circuits on `!willBeMemberOperator` — no projection read.
    expect(mocks.getMemberOperationByUserId).not.toHaveBeenCalled()
  })

  it('non-memberOperation role change (no projection) → none', async () => {
    mocks.getMemberOperationByUserId.mockResolvedValue(null)
    const step = await resolveMemberOperatorRoleStep({
      ...base,
      willBeMemberOperator: false,
    })
    expect(step.kind).toBe('none')
  })
})
