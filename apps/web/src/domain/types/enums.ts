import { Schema } from 'effect'

export const Role = Schema.Literal('owner', 'manager', 'member_operator', 'receptionist')
export type Role = typeof Role.Type

export const ROLES: readonly Role[] = ['owner', 'manager', 'member_operator', 'receptionist']

export const Vertical = Schema.Literal('barbershop', 'auto_wash', 'auto_detailing', 'other')
export type Vertical = typeof Vertical.Type

export const VERTICALS: readonly Vertical[] = ['barbershop', 'auto_wash', 'auto_detailing', 'other']

// Derived operational readiness for a MemberOperation being allowed to operate
// (take bookings, appear on the agenda, receive split). There is no human
// approver: the status is computed from facts. The projection exists only after
// invite acceptance, so a memberOperation is either `incomplete` (joined, profile
// not yet bookable) or `operational` (whatsapp + ≥1 unit + ≥1 service).
export const OperationalStatus = Schema.Literal('incomplete', 'operational')
export type OperationalStatus = typeof OperationalStatus.Type

export const OPERATIONAL_STATUSES: readonly OperationalStatus[] = ['incomplete', 'operational']

export function isOperational(status: OperationalStatus): boolean {
  return status === 'operational'
}

export const MembershipStatus = Schema.Literal('active', 'invited', 'suspended', 'revoked')
export type MembershipStatus = typeof MembershipStatus.Type

export const InviteStatus = Schema.Literal('pending', 'accepted', 'expired', 'revoked')
export type InviteStatus = typeof InviteStatus.Type

export function canManageOrg(role: Role): boolean {
  return role === 'owner' || role === 'manager'
}

export function canInviteMembers(role: Role): boolean {
  return role === 'owner' || role === 'manager'
}
