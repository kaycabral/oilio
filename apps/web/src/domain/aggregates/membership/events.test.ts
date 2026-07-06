// Decode-boundary tests for the membership event schemas. The `membership.created`
// payload is where legacy event streams are normalized on replay WITHOUT an
// upcaster (the repo idiom): the renamed `unitId` key maps onto `rlsUnitScope`,
// and — #1377 — capability keys absent from a pre-existing event are backfilled
// from the role default so a legacy OWNER keeps billing instead of replaying to
// the role-blind schema default.

import { defaultPermissionsForRole } from '@/domain/types/membership'
import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { MembershipCreatedSchema } from './events'

const decodeCreated = Schema.decodeUnknownSync(MembershipCreatedSchema)

// A `membership.created` payload as written BEFORE `canManageBilling` existed:
// the permission object carries every other key but not the new capability.
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
  // Pre-rename events carry the unit lock under the old `unitId` key; the decode
  // boundary maps it onto the canonical `rlsUnitScope` without an upcaster.
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
