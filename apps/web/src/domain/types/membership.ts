import { Schema } from 'effect'

import { canManageOrg, MembershipStatus, Role } from './enums'

// Granular permissions live on the Membership so that fluid role transitions
// (recepcionista que atende às vezes, owner que também corta) are toggles —
// not schema migrations. `Role` provides the default set on creation (see
// `defaultPermissionsForRole`); code must gate by `permissions.<capability>`,
// never by `role` directly. Schema decision in
// [[02-Estrategia-Modelo-Identidade]] (#832 + #836).
export const MembershipPermissions = Schema.mutable(
  Schema.Struct({
    canHaveAgenda: Schema.Boolean,
    canManageOwnAgenda: Schema.Boolean,
    canCreateAppointment: Schema.Boolean,
    canCancelAppointment: Schema.Boolean,
    canManageCustomers: Schema.Boolean,
    canManageProfessionals: Schema.Boolean,
    canManageServices: Schema.Boolean,
    canViewFinancials: Schema.Boolean,
    canManagePlans: Schema.Boolean,
    canManageSubscriptions: Schema.Boolean,
  }),
)
export type MembershipPermissions = typeof MembershipPermissions.Type

export const Membership = Schema.mutable(
  Schema.Struct({
    id: Schema.String,
    orgId: Schema.String,
    userId: Schema.String,
    role: Role,
    status: MembershipStatus,
    invitedBy: Schema.NullOr(Schema.String),
    joinedAt: Schema.String,
    updatedAt: Schema.String,
    // Optional: scopes the membership to a single unit (typical for
    // receptionists assigned to a specific location). Null = scoped to the
    // org as a whole.
    unitId: Schema.NullOr(Schema.String),
    // Granular capability gates. Every creation path must populate this
    // explicitly — usually via `defaultPermissionsForRole(role)`. Code must
    // gate on `permissions.<capability>`, never on `role` directly.
    permissions: MembershipPermissions,
    // Only meaningful when role === 'professional'. May differ per org
    // (Maria 50% no Salão A, 60% no Salão B). Other roles set this to null.
    commissionRate: Schema.NullOr(Schema.Number),
  }),
)
export type Membership = typeof Membership.Type

export function membershipDocId(orgId: string, userId: string): string {
  return `${orgId}_${userId}`
}

// Single source of truth for the cross-unit gating predicate. A membership
// "operates cross-unit" when it can manage the org (owner/manager) AND is
// not bound to a single unit (`unitId == null`, i.e. org-wide). Since brief
// 0044 removed the cross-unit aggregate report view, the only surface this now
// gates is `/units` management — unit-bound managers, receptionists and
// professionals stay scoped to their own unit. Owner is always org-wide; a
// manager qualifies only when `unitId == null`. Keep this the only place the
// predicate is defined.
export function operatesCrossUnit(membership: Membership): boolean {
  return canManageOrg(membership.role) && !membership.unitId
}

// Short, human-facing description of what each role can do — derived from the
// capability set in `defaultPermissionsForRole`. Surfaced in the invite dialog
// (brief 0037 refino) so the inviter knows the privileges being granted, and
// reusable anywhere a role needs an at-a-glance explanation. Copy is pt-BR
// (humano-facing) and intentionally concise.
export function roleDescription(role: Role): string {
  switch (role) {
    case 'owner':
      return 'Acesso total: gerencia equipe, serviços, finanças e configurações do negócio.'
    case 'manager':
      return 'Gerencia equipe, serviços, planos e vê finanças — quase tudo, menos ser o dono.'
    case 'professional':
      return 'Tem agenda própria e gerencia os próprios atendimentos.'
    case 'receptionist':
      return 'Agenda e cancela atendimentos e gerencia clientes — sem acesso a finanças.'
    case 'customer':
      return 'Sem acesso operacional — existe só para aparecer no escopo do negócio.'
  }
}

const ALL_FALSE: MembershipPermissions = {
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
}

// Default permission set per role. Owner gets everything; manager mirrors
// owner minus financial-sensitive bits (kept open here for V0 simplicity
// but easy to tighten); professional gets agenda + appointments;
// receptionist gets customer + appointment ops; customer gets nothing
// (a customer membership exists so the user shows up in the org's
// scope — capability checks are not driven by customer memberships).
export function defaultPermissionsForRole(role: Role): MembershipPermissions {
  switch (role) {
    case 'owner':
      return {
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
      }
    case 'manager':
      return {
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
      }
    case 'professional':
      return {
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
      }
    case 'receptionist':
      return {
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
      }
    case 'customer':
      return ALL_FALSE
  }
}
