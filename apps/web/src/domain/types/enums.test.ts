import { describe, expect, it } from 'vitest'
import {
  canInviteMembers,
  canManageOrg,
  isOperational,
  OPERATIONAL_STATUSES,
  ROLES,
  VERTICALS,
  type OperationalStatus,
  type Role,
} from './enums'

describe('enum value lists', () => {
  it('ROLES holds every role in order', () => {
    expect(ROLES).toEqual(['owner', 'manager', 'member_operator', 'receptionist'])
  })

  it('VERTICALS holds every vertical in order', () => {
    expect(VERTICALS).toEqual(['barbershop', 'auto_wash', 'auto_detailing', 'other'])
  })

  it('OPERATIONAL_STATUSES holds every status in order', () => {
    expect(OPERATIONAL_STATUSES).toEqual(['incomplete', 'operational'])
  })
})

describe('isOperational', () => {
  it('is true only for "operational"', () => {
    const expected: Record<OperationalStatus, boolean> = {
      incomplete: false,
      operational: true,
    }
    for (const status of OPERATIONAL_STATUSES) {
      expect(isOperational(status)).toBe(expected[status])
    }
  })
})

describe('canManageOrg / canInviteMembers', () => {
  const expected: Record<Role, boolean> = {
    owner: true,
    manager: true,
    member_operator: false,
    receptionist: false,
  }

  for (const role of ROLES) {
    it(`canManageOrg(${role}) === ${expected[role]}`, () => {
      expect(canManageOrg(role)).toBe(expected[role])
    })
    it(`canInviteMembers(${role}) === ${expected[role]}`, () => {
      expect(canInviteMembers(role)).toBe(expected[role])
    })
  }
})
