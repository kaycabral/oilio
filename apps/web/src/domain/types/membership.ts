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
    canManageOperators: Schema.Boolean,
    canManageCatalog: Schema.Boolean,
    canViewFinancials: Schema.Boolean,
    canManagePlans: Schema.Boolean,
    canManageSubscriptions: Schema.Boolean,
    // Billing authorization (brief 0075, #1377): may subscribe/manage/cancel the
    // Assinatura Oilio for the org. Owner-only preset — replaces the `role ===
    // 'owner'` gate on billing actions with a data-driven capability.
    //
    // `optionalWith` (NOT a plain required boolean) so memberships persisted before
    // this key existed (the `membership.created` event payload + the JSONB column,
    // including the real production org) still decode instead of hard-failing. But
    // the schema default is role-BLIND, so a bare `default: false` here would strip
    // billing from a legacy OWNER (observable regression). The role-aware backfill
    // is `withRoleDefaultedPermissions` below, applied at every read boundary
    // (projector `rowToDoc` + event replay) where the role is in scope — it fills an
    // absent `canManageBilling` from `defaultPermissionsForRole(role)`. This schema
    // default is only the last-resort safety net (a decode with no role context);
    // it stays `false` (deny) so an unknown-role decode is never over-permissive.
    // Tolerant decode at the boundary, no migration/upcaster (the repo idiom —
    // mirrors `rlsUnitScope`'s legacy `unitId` handling).
    canManageBilling: Schema.optionalWith(Schema.Boolean, { default: () => false, exact: true }),
    // Operational capabilities (brief 0076). "Being bookable/commissionable" is a
    // capability any member can have toggled — NOT a class of person. `canBeBooked`
    // makes the member eligible to appear on the agenda and take bookings;
    // `canEarnCommission` makes them eligible for commission attribution. The
    // `memberOperation` preset turns both on; other presets leave them off (but
    // they're plain toggles, editable in the future). "Member eligible for
    // agenda/commission" is read from the capability, never from the role/type —
    // this retires the runtime `BookableProfessional` brand (AC-01/AC-03).
    canBeBooked: Schema.Boolean,
    canEarnCommission: Schema.Boolean,
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
  // `memberOperations.unitIds[]` (a memberOperation's areas of operation); the DB
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
// and memberOperations stay scoped to their own unit. Owner is always org-wide; a
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
    case 'member_operator':
      return 'Tem agenda própria e gerencia os próprios atendimentos.'
    case 'receptionist':
      return 'Agenda e cancela atendimentos e gerencia clientes — sem acesso a finanças.'
  }
}

// Short, human-facing name for each role — the label shown in role pickers, the
// team list, and the invite/accept screens. Single source so the copy can't
// drift across surfaces (it was duplicated verbatim in InviteForm, TeamList and
// the accept page, which showed the raw enum key — #1299). Copy is pt-BR.
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

// Default permission set per role. Owner gets everything; manager mirrors
// owner minus financial-sensitive bits (kept open here for V0 simplicity
// but easy to tighten); memberOperation gets agenda + appointments;
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
        canManageOperators: true,
        canManageCatalog: true,
        canViewFinancials: true,
        canManagePlans: true,
        canManageSubscriptions: true,
        // Billing is owner-only (brief 0075, #1377) — the org's financial/
        // contractual commitment belongs to whoever answers for it.
        canManageBilling: true,
        // Not operational by default — an owner is org-management, not a person
        // who takes bookings. Editable later if they also cut hair.
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
        // Manager operates the business but does not commit the org to a paid
        // contract — billing stays owner-only (brief 0075, #1377).
        canManageBilling: false,
        canBeBooked: false,
        canEarnCommission: false,
      }
    case 'member_operator':
      return {
        canHaveAgenda: true,
        canManageOwnAgenda: true,
        // Autonomous own-scoped model (brief 0075): a memberOperation books and
        // cancels their OWN appointments (the picker is locked to themselves and
        // RLS scopes the write to their own rows). Manage* stays false — they
        // never touch customers/catalog/plans/subscriptions.
        canCreateAppointment: true,
        canCancelAppointment: true,
        canManageCustomers: false,
        canManageOperators: false,
        canManageCatalog: false,
        canViewFinancials: false,
        canManagePlans: false,
        canManageSubscriptions: false,
        canManageBilling: false,
        // The memberOperation preset is the only one that turns the operational
        // capabilities on (brief 0076 AC-01): eligible for the agenda and for
        // commission attribution. "Bookable" is now read from this bit, not
        // from the role/type.
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

// Backfills capability keys ABSENT from a persisted permission object with the
// role's default (brief 0075, #1377). Memberships written before a capability
// existed lack its key; the read-model schema tolerates that (`optionalWith`) but
// its default is role-blind, so a legacy OWNER would decode `canManageBilling:
// false` and silently lose billing management. Applied at every read boundary
// (projector row→doc + event replay) where the role is in scope, this restores
// the role-correct value: an absent key inherits `defaultPermissionsForRole(role)`,
// while any key PRESENT in the persisted object is preserved verbatim (an explicit
// toggle always wins over the default). Pure, idempotent, no migration —
// forward-compatible for the next capability added the same way.
export function withRoleDefaultedPermissions(
  role: Role,
  permissions: unknown,
): MembershipPermissions {
  // `permissions` is raw persisted JSONB (an object of capability booleans, or
  // null/absent). Merge the persisted keys OVER the role defaults so present keys
  // (explicit toggles) win and absent keys inherit the default. Non-object input
  // (null/legacy junk) falls back entirely to the role default. The result is
  // re-validated by the caller's `Membership` decode — this only backfills.
  const persisted = typeof permissions === 'object' && permissions !== null ? permissions : {}
  return { ...defaultPermissionsForRole(role), ...persisted }
}
