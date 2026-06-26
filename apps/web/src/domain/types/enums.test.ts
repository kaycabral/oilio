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
  // Pin the exact contents: an emptied array (ArrayDeclaration mutant) or a
  // blanked entry (StringLiteral mutant) would slip past the value-loops in
  // other suites, which pass vacuously over an empty list.
  it('ROLES holds every role in order', () => {
    expect(ROLES).toEqual(['owner', 'manager', 'professional', 'receptionist'])
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
  // Both gate on owner|manager — pin the full truth table so the `||` operands
  // and role literals are each load-bearing.
  const expected: Record<Role, boolean> = {
    owner: true,
    manager: true,
    professional: false,
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
