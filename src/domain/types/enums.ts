import { Schema } from 'effect'

export const Role = Schema.Literals(['owner', 'manager', 'member_operator', 'receptionist'])
export type Role = typeof Role.Type

export const ROLES: readonly Role[] = ['owner', 'manager', 'member_operator', 'receptionist']

export const Vertical = Schema.Literals(['barbershop', 'auto_wash', 'auto_detailing', 'other'])
export type Vertical = typeof Vertical.Type

export const VERTICALS: readonly Vertical[] = ['barbershop', 'auto_wash', 'auto_detailing', 'other']

export const OperationalStatus = Schema.Literals(['incomplete', 'operational'])
export type OperationalStatus = typeof OperationalStatus.Type

export const OPERATIONAL_STATUSES: readonly OperationalStatus[] = ['incomplete', 'operational']

export function isOperational(status: OperationalStatus): boolean {
  return status === 'operational'
}

export const MembershipStatus = Schema.Literals(['active', 'invited', 'suspended', 'revoked'])
export type MembershipStatus = typeof MembershipStatus.Type

export const InviteStatus = Schema.Literals(['pending', 'accepted', 'expired', 'revoked'])
export type InviteStatus = typeof InviteStatus.Type

export function canManageOrg(role: Role): boolean {
  return role === 'owner' || role === 'manager'
}

export function canInviteMembers(role: Role): boolean {
  return role === 'owner' || role === 'manager'
}
