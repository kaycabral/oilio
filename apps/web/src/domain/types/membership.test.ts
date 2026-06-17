import { describe, expect, it } from 'vitest'

import type { Role } from './enums'
import { ROLES } from './enums'
import type { Membership, MembershipPermissions } from './membership'
import {
  defaultPermissionsForRole,
  membershipDocId,
  operatesCrossUnit,
  roleDescription,
} from './membership'

function makeMembership(role: Role, unitId: string | null): Membership {
  return {
    id: membershipDocId('t1', 'u1'),
    tenantId: 't1',
    userId: 'u1',
    role,
    status: 'active',
    invitedBy: null,
    joinedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    unitId,
    permissions: defaultPermissionsForRole(role),
    commissionRate: null,
  }
}

const PERMISSION_KEYS: readonly (keyof MembershipPermissions)[] = [
  'canHaveAgenda',
  'canManageOwnAgenda',
  'canCreateAppointment',
  'canCancelAppointment',
  'canManageCustomers',
  'canManageProfessionals',
  'canManageServices',
  'canViewFinancials',
  'canManagePlans',
  'canManageSubscriptions',
] as const

describe('membershipDocId', () => {
  it('joins tenantId and userId with an underscore', () => {
    expect(membershipDocId('t1', 'u2')).toBe('t1_u2')
  })
})

// Exhaustive expected permission set per role — every field pinned so a flip
// of any single boolean in `defaultPermissionsForRole` is caught (mutation).
const EXPECTED_PERMISSIONS: Record<Role, MembershipPermissions> = {
  owner: {
    canHaveAgenda: false,
    canManageOwnAgenda: false,
    canCreateAppointment: true,
    canCancelAppointment: true,
    canManageCustomers: true,
    canManageProfessionals: true,
    canManageServices: true,
    canViewFinancials: true,
    canManagePlans: true,
    canManageSubscriptions: true,
  },
  manager: {
    canHaveAgenda: false,
    canManageOwnAgenda: false,
    canCreateAppointment: true,
    canCancelAppointment: true,
    canManageCustomers: true,
    canManageProfessionals: true,
    canManageServices: true,
    canViewFinancials: true,
    canManagePlans: true,
    canManageSubscriptions: true,
  },
  professional: {
    canHaveAgenda: true,
    canManageOwnAgenda: true,
    canCreateAppointment: false,
    canCancelAppointment: false,
    canManageCustomers: false,
    canManageProfessionals: false,
    canManageServices: false,
    canViewFinancials: false,
    canManagePlans: false,
    canManageSubscriptions: false,
  },
  receptionist: {
    canHaveAgenda: false,
    canManageOwnAgenda: false,
    canCreateAppointment: true,
    canCancelAppointment: true,
    canManageCustomers: true,
    canManageProfessionals: false,
    canManageServices: false,
    canViewFinancials: false,
    canManagePlans: false,
    canManageSubscriptions: false,
  },
  customer: {
    canHaveAgenda: false,
    canManageOwnAgenda: false,
    canCreateAppointment: false,
    canCancelAppointment: false,
    canManageCustomers: false,
    canManageProfessionals: false,
    canManageServices: false,
    canViewFinancials: false,
    canManagePlans: false,
    canManageSubscriptions: false,
  },
}

describe('defaultPermissionsForRole', () => {
  it('defines defaults for every role', () => {
    for (const role of ROLES) {
      const perms = defaultPermissionsForRole(role)
      for (const key of PERMISSION_KEYS) {
        expect(typeof perms[key]).toBe('boolean')
      }
    }
  })

  for (const role of ROLES) {
    it(`returns the exact permission set for ${role}`, () => {
      expect(defaultPermissionsForRole(role)).toEqual(EXPECTED_PERMISSIONS[role])
    })
  }

  it('returns a fresh object each call so callers can safely mutate', () => {
    const a = defaultPermissionsForRole('owner')
    const b = defaultPermissionsForRole('owner')
    expect(a).not.toBe(b)
    a.canManagePlans = false
    expect(b.canManagePlans).toBe(true)
  })
})

describe('roleDescription', () => {
  // Pin the exact copy per role: string-literal mutants (→ "") are killed, and
  // every role branch is exercised so a fall-through is caught.
  const EXPECTED: Record<Role, string> = {
    owner: 'Acesso total: gerencia equipe, serviços, finanças e configurações do negócio.',
    manager: 'Gerencia equipe, serviços, planos e vê finanças — quase tudo, menos ser o dono.',
    professional: 'Tem agenda própria e gerencia os próprios atendimentos.',
    receptionist: 'Agenda e cancela atendimentos e gerencia clientes — sem acesso a finanças.',
    customer: 'Sem acesso operacional — existe só para aparecer no escopo do negócio.',
  }

  for (const role of ROLES) {
    it(`returns the exact copy for ${role}`, () => {
      expect(roleDescription(role)).toBe(EXPECTED[role])
    })
  }
})

describe('operatesCrossUnit', () => {
  it('is true for an owner (always tenant-wide, unitId null)', () => {
    expect(operatesCrossUnit(makeMembership('owner', null))).toBe(true)
  })

  it('is true for a tenant-wide manager (unitId null)', () => {
    expect(operatesCrossUnit(makeMembership('manager', null))).toBe(true)
  })

  it('is false for a manager bound to a unit (unitId set)', () => {
    expect(operatesCrossUnit(makeMembership('manager', 'unit-1'))).toBe(false)
  })

  it('is false for an owner bound to a unit (defensive — owner is normally tenant-wide)', () => {
    expect(operatesCrossUnit(makeMembership('owner', 'unit-1'))).toBe(false)
  })

  it('is false for a receptionist (cannot manage tenant)', () => {
    expect(operatesCrossUnit(makeMembership('receptionist', null))).toBe(false)
    expect(operatesCrossUnit(makeMembership('receptionist', 'unit-1'))).toBe(false)
  })

  it('is false for a professional (cannot manage tenant)', () => {
    expect(operatesCrossUnit(makeMembership('professional', null))).toBe(false)
  })

  it('is false for a customer (cannot manage tenant)', () => {
    expect(operatesCrossUnit(makeMembership('customer', null))).toBe(false)
  })
})
