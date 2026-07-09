import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import type { Role } from './enums'
import { ROLES } from './enums'
import type { Membership, MembershipPermissions } from './membership'
import {
  defaultPermissionsForRole,
  membershipDocId,
  MembershipPermissions as MembershipPermissionsSchema,
  operatesCrossUnit,
  roleDescription,
  roleLabel,
  withRoleDefaultedPermissions,
} from './membership'

function makeMembership(role: Role, rlsUnitScope: string | null): Membership {
  return {
    id: membershipDocId('t1', 'u1'),
    orgId: 't1',
    userId: 'u1',
    role,
    status: 'active',
    invitedBy: null,
    joinedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    rlsUnitScope,
    permissions: defaultPermissionsForRole(role),
  }
}

const PERMISSION_KEYS: readonly (keyof MembershipPermissions)[] = [
  'canHaveAgenda',
  'canManageOwnAgenda',
  'canCreateAppointment',
  'canCancelAppointment',
  'canManageCustomers',
  'canManageOperators',
  'canManageCatalog',
  'canViewFinancials',
  'canManagePlans',
  'canManageSubscriptions',
  'canManageBilling',
  'canBeBooked',
  'canEarnCommission',
] as const

describe('membershipDocId', () => {
  it('joins orgId and userId with an underscore', () => {
    expect(membershipDocId('t1', 'u2')).toBe('t1_u2')
  })
})

const EXPECTED_PERMISSIONS: Record<Role, MembershipPermissions> = {
  owner: {
    canHaveAgenda: false,
    canManageOwnAgenda: false,
    canCreateAppointment: true,
    canCancelAppointment: true,
    canManageCustomers: true,
    canManageOperators: true,
    canManageCatalog: true,
    canViewFinancials: true,
    canManagePlans: true,
    canManageSubscriptions: true,
    canManageBilling: true,
    canBeBooked: false,
    canEarnCommission: false,
  },
  manager: {
    canHaveAgenda: false,
    canManageOwnAgenda: false,
    canCreateAppointment: true,
    canCancelAppointment: true,
    canManageCustomers: true,
    canManageOperators: true,
    canManageCatalog: true,
    canViewFinancials: true,
    canManagePlans: true,
    canManageSubscriptions: true,
    canManageBilling: false,
    canBeBooked: false,
    canEarnCommission: false,
  },
  member_operator: {
    canHaveAgenda: true,
    canManageOwnAgenda: true,
    canCreateAppointment: true,
    canCancelAppointment: true,
    canManageCustomers: false,
    canManageOperators: false,
    canManageCatalog: false,
    canViewFinancials: false,
    canManagePlans: false,
    canManageSubscriptions: false,
    canManageBilling: false,
    canBeBooked: true,
    canEarnCommission: true,
  },
  receptionist: {
    canHaveAgenda: false,
    canManageOwnAgenda: false,
    canCreateAppointment: true,
    canCancelAppointment: true,
    canManageCustomers: true,
    canManageOperators: false,
    canManageCatalog: false,
    canViewFinancials: false,
    canManagePlans: false,
    canManageSubscriptions: false,
    canManageBilling: false,
    canBeBooked: false,
    canEarnCommission: false,
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

describe('canManageBilling capability (#1377)', () => {
  it('grants billing only to the owner (owner-only preset)', () => {
    expect(defaultPermissionsForRole('owner').canManageBilling).toBe(true)
    for (const role of ROLES) {
      if (role === 'owner') continue
      expect(defaultPermissionsForRole(role).canManageBilling).toBe(false)
    }
  })

  it('decodes a legacy membership without the key as canManageBilling=false', () => {
    const legacy = {
      canHaveAgenda: false,
      canManageOwnAgenda: false,
      canCreateAppointment: true,
      canCancelAppointment: true,
      canManageCustomers: true,
      canManageOperators: true,
      canManageCatalog: true,
      canViewFinancials: true,
      canManagePlans: true,
      canManageSubscriptions: true,
      canBeBooked: false,
      canEarnCommission: false,
    }
    const decoded = Schema.decodeUnknownSync(MembershipPermissionsSchema)(legacy)
    expect(decoded.canManageBilling).toBe(false)
  })

  it('respects an explicit canManageBilling on decode', () => {
    const decoded = Schema.decodeUnknownSync(MembershipPermissionsSchema)({
      ...defaultPermissionsForRole('manager'),
      canManageBilling: true,
    })
    expect(decoded.canManageBilling).toBe(true)
  })
})

describe('withRoleDefaultedPermissions (#1377)', () => {
  const legacyOwnerPerms = {
    canHaveAgenda: false,
    canManageOwnAgenda: false,
    canCreateAppointment: true,
    canCancelAppointment: true,
    canManageCustomers: true,
    canManageOperators: true,
    canManageCatalog: true,
    canViewFinancials: true,
    canManagePlans: true,
    canManageSubscriptions: true,
    canBeBooked: false,
    canEarnCommission: false,
  }

  it('restores canManageBilling for a legacy owner from the role default', () => {
    const perms = withRoleDefaultedPermissions('owner', legacyOwnerPerms)
    expect(perms.canManageBilling).toBe(true)
  })

  it('leaves a legacy non-owner denied (role default is false)', () => {
    for (const role of ['manager', 'receptionist', 'member_operator'] as const) {
      const { canManageBilling: _omit, ...legacyNonOwner } = defaultPermissionsForRole(role)
      expect(withRoleDefaultedPermissions(role, legacyNonOwner).canManageBilling).toBe(false)
    }
  })

  it('preserves an explicitly-present key over the role default', () => {
    const perms = withRoleDefaultedPermissions('owner', {
      ...legacyOwnerPerms,
      canManageBilling: false,
    })
    expect(perms.canManageBilling).toBe(false)
  })

  it('falls back entirely to the role default for null/non-object input', () => {
    expect(withRoleDefaultedPermissions('owner', null)).toEqual(defaultPermissionsForRole('owner'))
    expect(withRoleDefaultedPermissions('receptionist', undefined)).toEqual(
      defaultPermissionsForRole('receptionist'),
    )
  })
})

describe('roleDescription', () => {
  const EXPECTED: Record<Role, string> = {
    owner: 'Acesso total: gerencia equipe, serviços, finanças e configurações do negócio.',
    manager: 'Gerencia equipe, serviços, planos e vê finanças — quase tudo, menos ser o dono.',
    member_operator: 'Tem agenda própria e gerencia os próprios atendimentos.',
    receptionist: 'Agenda e cancela atendimentos e gerencia clientes — sem acesso a finanças.',
  }

  for (const role of ROLES) {
    it(`returns the exact copy for ${role}`, () => {
      expect(roleDescription(role)).toBe(EXPECTED[role])
    })
  }
})

describe('roleLabel', () => {
  const EXPECTED: Record<Role, string> = {
    owner: 'Dono',
    manager: 'Gerente',
    member_operator: 'Profissional',
    receptionist: 'Recepção',
  }

  for (const role of ROLES) {
    it(`returns the exact label for ${role}`, () => {
      expect(roleLabel(role)).toBe(EXPECTED[role])
    })
  }
})

describe('operatesCrossUnit', () => {
  it('is true for an owner (always org-wide, rlsUnitScope null)', () => {
    expect(operatesCrossUnit(makeMembership('owner', null))).toBe(true)
  })

  it('is true for a org-wide manager (rlsUnitScope null)', () => {
    expect(operatesCrossUnit(makeMembership('manager', null))).toBe(true)
  })

  it('is false for a manager bound to a unit (rlsUnitScope set)', () => {
    expect(operatesCrossUnit(makeMembership('manager', 'unit-1'))).toBe(false)
  })

  it('is false for an owner bound to a unit (defensive — owner is normally org-wide)', () => {
    expect(operatesCrossUnit(makeMembership('owner', 'unit-1'))).toBe(false)
  })

  it('is false for a receptionist (cannot manage org)', () => {
    expect(operatesCrossUnit(makeMembership('receptionist', null))).toBe(false)
    expect(operatesCrossUnit(makeMembership('receptionist', 'unit-1'))).toBe(false)
  })

  it('is false for a memberOperation (cannot manage org)', () => {
    expect(operatesCrossUnit(makeMembership('member_operator', null))).toBe(false)
  })
})
