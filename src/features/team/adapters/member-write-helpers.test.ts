import type { MemberOperation } from '@/domain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getMemberOperationByUserId: vi.fn(),
}))
vi.mock('@/shared/org/member-operation-read', () => ({
  getMemberOperationById: vi.fn(),
  getMemberOperationByUserId: mocks.getMemberOperationByUserId,
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
    mobile: '5511999999999',
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
