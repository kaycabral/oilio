import { defaultPermissionsForRole } from '@/domain/types/membership'
import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { MembershipCreatedSchema } from './events'

const decodeCreated = Schema.decodeUnknownSync(MembershipCreatedSchema)

function legacyCreatedEvent(role: 'owner' | 'manager') {
  const { canManageBilling: _omit, ...legacyPerms } = defaultPermissionsForRole(role)
  return {
    _tag: 'membership.created' as const,
    data: {
      id: `org-1_user-1`,
      orgId: 'org-1',
      userId: 'user-1',
      role,
      status: 'active',
      invitedBy: null,
      joinedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      rlsUnitScope: null,
      permissions: legacyPerms,
    },
  }
}

describe('MembershipCreatedSchema — legacy replay (#1377)', () => {
  it('backfills canManageBilling=true when replaying a legacy OWNER event', () => {
    const decoded = decodeCreated(legacyCreatedEvent('owner'))
    expect(decoded.data.permissions.canManageBilling).toBe(true)
  })

  it('keeps a legacy non-owner denied (canManageBilling=false)', () => {
    const decoded = decodeCreated(legacyCreatedEvent('manager'))
    expect(decoded.data.permissions.canManageBilling).toBe(false)
  })

  it('preserves an explicitly-present capability over the role default', () => {
    const event = legacyCreatedEvent('manager')
    const decoded = decodeCreated({
      ...event,
      data: { ...event.data, permissions: { ...event.data.permissions, canManageBilling: true } },
    })
    expect(decoded.data.permissions.canManageBilling).toBe(true)
  })
})

describe('MembershipCreatedSchema — legacy rlsUnitScope normalization', () => {
  it('maps a legacy `unitId` payload onto `rlsUnitScope`', () => {
    const event = legacyCreatedEvent('manager')
    const { rlsUnitScope: _drop, ...dataWithoutScope } = event.data
    const decoded = decodeCreated({
      ...event,
      data: { ...dataWithoutScope, unitId: 'unit-9' },
    })
    expect(decoded.data.rlsUnitScope).toBe('unit-9')
  })
})
