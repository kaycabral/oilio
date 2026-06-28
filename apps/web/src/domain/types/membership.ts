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
    canManageCatalog: Schema.Boolean,
    canViewFinancials: Schema.Boolean,
    canManagePlans: Schema.Boolean,
    canManageSubscriptions: Schema.Boolean,
  }),
)
export type MembershipPermissions = typeof MembershipPermissions.Type

// Field map shared by the read-model `Membership` schema and the
// `membership.created` event payload schema (the latter re-keys `rlsUnitScope`
// to tolerate the legacy `unitId` wire key — see `aggregates/membership/events.ts`).
// Exported so the event schema reuses the exact same field definitions without
// reaching into the `Schema.mutable` wrapper (which hides `.fields`).
export const MembershipFields = {
  id: Schema.String,
  orgId: Schema.String,
  userId: Schema.String,
  role: Role,
  status: MembershipStatus,
  invitedBy: Schema.NullOr(Schema.String),
  joinedAt: Schema.String,
  updatedAt: Schema.String,
  // Single-unit RLS lock: scopes the membership to one unit (typical for a
  // receptionist assigned to a specific location). Null = scoped to the org
  // as a whole. Renamed from `unitId` (brief 0068 D4) to disambiguate from
  // `professionals.unitIds[]` (a professional's areas of operation); the DB
  // column is `rls_unit_scope` and the RLS unit policy filters on it.
  //
  // This is the canonical read-model / projection key (symmetric across the
  // reducer state, the projector and `rowToDoc`). Legacy `membership.created`
  // events whose payload carries the old `unitId` key are tolerated at the
  // EVENT decode boundary only (see `MembershipCreatedDataSchema` in
  // `aggregates/membership/events.ts`), so replay stays safe without an
  // upcaster.
  rlsUnitScope: Schema.NullOr(Schema.String),
  // Granular capability gates. Every creation path must populate this
  // explicitly — usually via `defaultPermissionsForRole(role)`. Code must
  // gate on `permissions.<capability>`, never on `role` directly.
  permissions: MembershipPermissions,
} as const

export const Membership = Schema.mutable(Schema.Struct(MembershipFields))
export type Membership = typeof Membership.Type

export function membershipDocId(orgId: string, userId: string): string {
  return `${orgId}_${userId}`
}

// Single source of truth for the cross-unit gating predicate. A membership
// "operates cross-unit" when it can manage the org (owner/manager) AND is
// not bound to a single unit (`rlsUnitScope == null`, i.e. org-wide). Since
// brief 0044 removed the cross-unit aggregate report view, the only surface
// this now gates is `/units` management — unit-bound managers, receptionists
// and professionals stay scoped to their own unit. Owner is always org-wide; a
// manager qualifies only when `rlsUnitScope == null`. Keep this the only place
// the predicate is defined.
export function operatesCrossUnit(membership: Membership): boolean {
  return canManageOrg(membership.role) && !membership.rlsUnitScope
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
  }
}

// Default permission set per role. Owner gets everything; manager mirrors
// owner minus financial-sensitive bits (kept open here for V0 simplicity
// but easy to tighten); professional gets agenda + appointments;
// receptionist gets customer + appointment ops. There is no `customer` role —
// a person who is a client of the org lives in the `customers` table, never as a
// membership (brief 0068 D4 / AC-04: the vestigial role was removed).
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
        canManageCatalog: true,
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
        canManageCatalog: true,
        canViewFinancials: true,
        canManagePlans: true,
        canManageSubscriptions: true,
      }
    case 'professional':
      return {
        canHaveAgenda: true,
        canManageOwnAgenda: true,
        // Autonomous own-scoped model (brief 0075): a professional books and
        // cancels their OWN appointments (the picker is locked to themselves and
        // RLS scopes the write to their own rows). Manage* stays false — they
        // never touch customers/catalog/plans/subscriptions.
        canCreateAppointment: true,
        canCancelAppointment: true,
        canManageCustomers: false,
        canManageProfessionals: false,
        canManageCatalog: false,
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
        canManageCatalog: false,
        canViewFinancials: false,
        canManagePlans: false,
        canManageSubscriptions: false,
      }
  }
}
