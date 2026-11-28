import { Effect, Schema, Struct } from 'effect'

import { canManageOrg, MembershipStatus, Role } from './enums'

export const MembershipPermissions = Schema.Struct({
  canHaveAgenda: Schema.Boolean,
  canManageOwnAgenda: Schema.Boolean,
  canCreateAppointment: Schema.Boolean,
  canCancelAppointment: Schema.Boolean,
  canManageCustomers: Schema.Boolean,
  canManageOperators: Schema.Boolean,
  canManageCatalog: Schema.Boolean,
  canViewFinancials: Schema.Boolean,
  canManagePlans: Schema.Boolean,
  canManageSubscriptions: Schema.Boolean,
  canManageBilling: Schema.Boolean.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(false))),
  canBeBooked: Schema.Boolean,
  canEarnCommission: Schema.Boolean,
}).mapFields(Struct.map(Schema.mutableKey))
export type MembershipPermissions = typeof MembershipPermissions.Type

export const MembershipFields = {
  id: Schema.String,
  orgId: Schema.String,
  userId: Schema.String,
  role: Role,
  status: MembershipStatus,
  invitedBy: Schema.NullOr(Schema.String),
  joinedAt: Schema.String,
  updatedAt: Schema.String,
  rlsUnitScope: Schema.NullOr(Schema.String),
  permissions: MembershipPermissions,
} as const

export const Membership = Schema.Struct(MembershipFields).mapFields(Struct.map(Schema.mutableKey))
export type Membership = typeof Membership.Type

export function membershipDocId(orgId: string, userId: string): string {
  return `${orgId}_${userId}`
}

export function operatesCrossUnit(membership: Membership): boolean {
  return canManageOrg(membership.role) && !membership.rlsUnitScope
}

export function roleDescription(role: Role): string {
  switch (role) {
    case 'owner':
      return 'Acesso total: gerencia equipe, serviços, finanças e configurações do negócio.'
    case 'manager':
      return 'Gerencia equipe, serviços, planos e vê finanças — quase tudo, menos ser o dono.'
    case 'member_operator':
      return 'Tem agenda própria e gerencia os próprios atendimentos.'
    case 'receptionist':
      return 'Agenda e cancela atendimentos e gerencia clientes — sem acesso a finanças.'
  }
}

export function roleLabel(role: Role): string {
  switch (role) {
    case 'owner':
      return 'Dono'
    case 'manager':
      return 'Gerente'
    case 'member_operator':
      return 'Profissional'
    case 'receptionist':
      return 'Recepção'
  }
}

export function defaultPermissionsForRole(role: Role): MembershipPermissions {
  switch (role) {
    case 'owner':
      return {
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
      }
    case 'manager':
      return {
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
      }
    case 'member_operator':
      return {
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
      }
    case 'receptionist':
      return {
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
      }
  }
}

export function withRoleDefaultedPermissions(
  role: Role,
  permissions: unknown,
): MembershipPermissions {
  const persisted = typeof permissions === 'object' && permissions !== null ? permissions : {}
  return { ...defaultPermissionsForRole(role), ...persisted }
}
