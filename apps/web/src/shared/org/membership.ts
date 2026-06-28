import {
  canManageOrg,
  Membership,
  membershipDocId,
  resolveSubjectName,
  ROLE_SUBJECT_NOUN,
  type MembershipPermissions,
  type Role,
  type User,
} from '@/domain'
import { hasCapability, type Capability } from '@/domain/billing/capabilities'
import { rowToDoc, type MembershipRow } from '@/shared/db/pg/effect/membership-projector'
import { getPublicOrgNamesByIds } from '@/shared/db/pg/public-org-directory'
import { readAsSubject, readUnderRls } from '@/shared/db/pg/rls-read'
import { getUserById, getUsersByIds } from '@/shared/db/pg/users-store'
import { getSessionUser, type SessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { getOrgTier } from '@/shared/org/billing-read'
import { Schema } from 'effect'
import type { Route } from 'next'
import { redirect } from 'next/navigation'
import 'server-only'

const decodeMembership = Schema.decodeUnknownSync(Membership)

export type OrgContext = {
  user: User
  membership: Membership
}

export async function getUserDoc(uid: string): Promise<User | null> {
  return getUserById(uid)
}

export async function getMembership(orgId: string, uid: string): Promise<Membership | null> {
  const rows = await readUnderRls<MembershipRow>(orgId, (client) =>
    client
      .query<MembershipRow>('SELECT * FROM memberships WHERE org_id = $1 AND id = $2', [
        orgId,
        membershipDocId(orgId, uid),
      ])
      .then((res) => res.rows),
  )
  const row = rows[0]
  return row ? decodeMembership(rowToDoc(row)) : null
}

// CROSS-ORG read (the login/org-switcher path: "which orgs does this user belong
// to?", before any active org is chosen). There is no single `app.current_org`
// to scope by — the answer spans orgs — so it reads under the PER-SUBJECT policy
// (`readAsSubject` sets `app.current_user_id`): the membership table's additional
// per-subject SELECT policy (brief 0062) returns only this user's own rows.
export async function getUserMemberships(uid: string): Promise<Membership[]> {
  const rows = await readAsSubject<MembershipRow>(uid, (client) =>
    client
      .query<MembershipRow>("SELECT * FROM memberships WHERE user_id = $1 AND status = 'active'", [
        uid,
      ])
      .then((res) => res.rows),
  )
  return rows.map((r) => decodeMembership(rowToDoc(r)))
}

// A member operável de um org, identificado pelo `userId` global (brief 0030,
// AC-04). Usado pra atribuir item a um membro: o select de "Executor/Vendedor"
// lista estes e grava o `userId` em `OrderItem.attributedUserId`. Nome vem LIVE
// do doc `users/` (#1046), não da membership.
export type OrgMember = {
  userId: string
  name: string
  role: Role
  // Null = membership escopada ao org; non-null = travada numa unidade
  // (o lock de unidade da membership, espelha `Membership.rlsUnitScope`).
  rlsUnitScope: string | null
}

/**
 * Membros operáveis de um org (brief 0030, AC-04): memberships ativas com
 * papel operacional (exclui `customer`), enriquecidas com o displayName LIVE do
 * `users/`. É a fonte do controle de atribuição por membro — qualquer membro
 * (recepção inclusa), não só Professional. Ordenado por nome. Sem cross-org
 * query: filtra por `orgId` na coleção top-level `memberships`.
 */
// Active memberships of an org — reads the typed table under RLS (scoped to
// `orgId`), returning the decoded `Membership` shape.
async function listActiveOrgMemberships(orgId: string): Promise<Membership[]> {
  const rows = await readUnderRls<MembershipRow>(orgId, (client) =>
    client
      .query<MembershipRow>("SELECT * FROM memberships WHERE org_id = $1 AND status = 'active'", [
        orgId,
      ])
      .then((res) => res.rows),
  )
  return rows.map((r) => decodeMembership(rowToDoc(r)))
}

// ALL memberships of an org (any status — active/invited/suspended/revoked). The
// team page (`load-team`) lists the full roster including non-active members, so
// it can't use `listActiveOrgMemberships` (which filters to active). Reads the
// typed table under RLS (scoped to `orgId`).
export async function listMembershipsForOrg(orgId: string): Promise<Membership[]> {
  const rows = await readUnderRls<MembershipRow>(orgId, (client) =>
    client
      .query<MembershipRow>('SELECT * FROM memberships WHERE org_id = $1', [orgId])
      .then((res) => res.rows),
  )
  return rows.map((r) => decodeMembership(rowToDoc(r)))
}

export async function listOrgMembers(orgId: string): Promise<OrgMember[]> {
  // Every active membership with a linked user is a team member: there is no
  // `customer` role anymore (brief 0068 D4 / AC-04) — a client of the org lives
  // in the `customers` table, never as a membership.
  const memberships = (await listActiveOrgMemberships(orgId)).filter((m) => Boolean(m.userId))
  // Hydrate member names LIVE from the global `users` table (batch).
  const userByUserId = await getUsersByIds(memberships.map((m) => m.userId))
  return memberships
    .map((m) => {
      // Anonymized accounts (LGPD #1095, AC-03) resolve to the neutral label
      // `‹Role› ‹CODE›` keyed by the member's role (Profissional / Recepção …).
      //
      // The CUSTOMER per-org block (#1096/#1100) is NOT applied here: members
      // are the professional/employment relationship (brief 0032 re-scope 04/06),
      // retained IDENTIFIABLE (art. 16). A person blocked as a customer in this
      // org still shows their real name on the team/commissions surfaces.
      const resolved = resolveSubjectName(
        m.userId,
        userByUserId.get(m.userId),
        ROLE_SUBJECT_NOUN[m.role],
      )
      return {
        userId: m.userId,
        name: resolved || '(membro sem nome)',
        role: m.role,
        rlsUnitScope: m.rlsUnitScope ?? null,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }))
}

// The user ids whose membership is CURRENTLY active AND carries the `canBeBooked`
// capability — the set that legitimately appears on operational surfaces (the
// agenda) right now. This replaces the old `role = 'professional'` axis with the
// capability (brief 0076 AC-01/AC-03): "bookable" is read from the membership's
// `permissions.canBeBooked`, NOT from a class of person — so a non-professional
// member with `canBeBooked` toggled on appears, and a professional with it off
// (soft-disabled) drops, with no special-casing. The projection (`professionals`)
// can still diverge from the capability (a row can outlive a toggle), so the
// agenda read cross-checks the projection against THIS set. Keyed on CURRENT
// state — never history. Reads the typed table under RLS; the capability lives in
// the `permissions` JSONB, queried with the `->>` text accessor.
export async function listBookableMemberUserIds(orgId: string): Promise<Set<string>> {
  const rows = await readUnderRls<{ user_id: string }>(orgId, (client) =>
    client
      .query<{
        user_id: string
      }>(
        `SELECT user_id FROM memberships
         WHERE org_id = $1 AND status = 'active' AND permissions->>'canBeBooked' = 'true'`,
        [orgId],
      )
      .then((res) => res.rows),
  )
  return new Set(rows.map((r) => r.user_id))
}

export type OrgOption = { id: string; name: string }

/**
 * Orgs the user is an active member of, with their display name (brief 0029,
 * AC-09). Drives the org switcher — shown only when length >= 2. Resolves the
 * names from the PUBLIC org directory in one batch (no org context needed); a
 * dangling membership whose org is missing falls back to the id.
 */
export async function listAccessibleOrgs(uid: string): Promise<OrgOption[]> {
  const memberships = await getUserMemberships(uid)
  if (memberships.length === 0) return []
  const nameById = await getPublicOrgNamesByIds(memberships.map((m) => m.orgId))
  return memberships
    .map((m) => ({ id: m.orgId, name: nameById.get(m.orgId) ?? m.orgId }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function getActiveOrgContext(uid: string): Promise<OrgContext | null> {
  const user = await getUserDoc(uid)
  if (!user || !user.currentOrgId) return null
  const membership = await getMembership(user.currentOrgId, uid)
  if (!membership || membership.status !== 'active') return null
  return { user, membership }
}

export class AuthzError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthzError'
  }
}

export function assertRole(membership: Membership, ...allowed: Role[]): void {
  if (!allowed.includes(membership.role)) {
    throw new AuthzError(
      `Role ${membership.role} not in allowed set [${allowed.join(', ')}] for org ${membership.orgId}`,
    )
  }
}

export function assertCanManage(membership: Membership): void {
  if (!canManageOrg(membership.role)) {
    throw new AuthzError(`Role ${membership.role} cannot manage org ${membership.orgId}`)
  }
}

export type RequiredOrgCtx = OrgContext & { session: SessionUser }

/**
 * Resolves session + org context in one shot for server actions / route handlers.
 * Returns a discriminated union — server actions can early-return the error result.
 */
export type RequireCtxResult = { ok: true; ctx: RequiredOrgCtx } | { ok: false; error: string }

export async function requireOrgCtx(): Promise<RequireCtxResult> {
  const session = await getSessionUser()
  if (!session) return { ok: false, error: 'Not signed in' }
  if (!session.emailVerified) return { ok: false, error: 'Email not verified' }
  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) return { ok: false, error: 'No active org' }
  return { ok: true, ctx: { ...ctx, session } }
}

export async function requireManagerCtx(): Promise<RequireCtxResult> {
  const base = await requireOrgCtx()
  if (!base.ok) return base
  if (!canManageOrg(base.ctx.membership.role)) {
    return { ok: false, error: 'Permission denied (owner or manager required)' }
  }
  return base
}

export async function requireOwnerCtx(): Promise<RequireCtxResult> {
  const base = await requireOrgCtx()
  if (!base.ok) return base
  if (base.ctx.membership.role !== 'owner') {
    return { ok: false, error: 'Permission denied (owner required)' }
  }
  return base
}

/**
 * PAGE guard for owner/manager-only routes (brief 0029, AC-08). Resolves the
 * org context and REDIRECTS (not a result union) when the visitor isn't an
 * org-manager — the server-side wall behind the nav `requires: 'manageOrg'`
 * gate, which is client-side and cosmetic. Use this as a one-liner in a route's
 * loader so a non-manager can't reach a hidden surface by typing the URL.
 *
 * Mirrors `loadReportsPage`'s inline gate, extracted so every manageOrg-gated
 * route shares ONE implementation — adding a route can't silently skip the
 * check (the cause of the original leak on /copilot, /team, /billing).
 * `notManagerTo` is where a non-manager lands (default `/agenda`, the
 * lowest-privilege operational home).
 */
export async function requireManagerPage(notManagerTo: Route = '/agenda'): Promise<RequiredOrgCtx> {
  if (!isFirebaseConfigured()) redirect('/')
  const session = await getSessionUser()
  if (!session) redirect('/login')
  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) redirect('/onboarding')
  if (!canManageOrg(ctx.membership.role)) redirect(notManagerTo)
  return { ...ctx, session }
}

/**
 * PAGE guard for routes gated on a membership CAPABILITY (brief 0075) — the
 * server-side wall behind the nav `requires: '<capability>'` gate. Resolves the
 * org context and REDIRECTS when the visitor's membership lacks `capability`, so
 * a self-scoped professional can't reach Clientes/Catálogo/Planos/Assinaturas by
 * typing the URL. Mirrors `requireManagerPage`, but keyed on the capability
 * matrix instead of `canManageOrg` — same one-liner usage in a loader.
 */
export async function requireCapabilityPage(
  capability: MembershipCapability,
  notAllowedTo: Route = '/agenda',
): Promise<RequiredOrgCtx> {
  if (!isFirebaseConfigured()) redirect('/')
  const session = await getSessionUser()
  if (!session) redirect('/login')
  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) redirect('/onboarding')
  if (!hasMembershipCapability(ctx.membership, capability)) redirect(notAllowedTo)
  return { ...ctx, session }
}

/**
 * Resolves org context AND asserts the active Negócio's Plano Oilio unlocks
 * `capability` (brief 0072). Layers on `requireOrgCtx` and reads the tier via
 * `getOrgBilling` (default-Free for Negócios with no billing row). Returns the
 * same discriminated union the role guards use, so a gated server action can
 * early-return the error. This is the REAL wall — the UI gate (useCapability) is
 * defense-in-depth, never the only check.
 */
export async function requireCapability(capability: Capability): Promise<RequireCtxResult> {
  const base = await requireOrgCtx()
  if (!base.ok) return base
  const tier = await getOrgTier(base.ctx.membership.orgId)
  if (!hasCapability(tier, capability)) {
    return {
      ok: false,
      error: `Plano ${tier} não inclui este recurso. Faça upgrade para continuar.`,
    }
  }
  return base
}

/**
 * A role-authorization capability — a boolean key of the membership's
 * permission matrix (`canManageCustomers`, `canCreateAppointment`, …). DISTINCT
 * from the billing `Capability` above (which is a plan/tier gate). This is the
 * APP-LEVEL authorization eixo: what this member is allowed to do, regardless of
 * plan. Canonical convention (brief 0075, `domain/types/membership.ts`): gate by
 * `permissions.<key>`, NEVER by `role` directly — so the four roles stay presets
 * of a capability set the business can later edit per role.
 */
export type MembershipCapability = keyof MembershipPermissions

/**
 * Pure predicate: does this membership carry `capability`? The single source of
 * truth for reading the permission matrix — nav gating, loaders and server
 * actions all derive from this rather than re-deriving from `role`.
 */
export function hasMembershipCapability(
  membership: Membership,
  capability: MembershipCapability,
): boolean {
  return membership.permissions[capability]
}

/**
 * Resolves org context AND asserts the active membership carries `capability`
 * (brief 0075). Layers on `requireOrgCtx`; returns the same discriminated union
 * the role guards use, so a gated server action can early-return the error. This
 * is the REAL wall for app-level authorization — the UI gate is defense-in-depth.
 */
export async function guardCapability(capability: MembershipCapability): Promise<RequireCtxResult> {
  const base = await requireOrgCtx()
  if (!base.ok) return base
  if (!hasMembershipCapability(base.ctx.membership, capability)) {
    return { ok: false, error: `Permission denied (${capability} required)` }
  }
  return base
}

/**
 * Distinguishes the **balcão** (owner/manager/recepção — operates the front desk
 * for everyone) from a **self-scoped professional** (acts only on their own
 * work). Brief 0075 model: recepção is the operational superset of a
 * professional. The marker is `canManageCustomers` — held by owner/manager/
 * recepção, never by a professional (whose matrix keeps every `canManage*`
 * false). A member who can manage the org's customers runs the counter; a member
 * who cannot is a professional bound to their own resources.
 */
export function operatesFrontDesk(membership: Membership): boolean {
  return canManageOrg(membership.role) || hasMembershipCapability(membership, 'canManageCustomers')
}

/**
 * Own-resource authorization (brief 0075, AC-03/AC-04). The balcão
 * (`operatesFrontDesk`) acts on ANY resource; everyone else (a self-scoped
 * professional) acts only on a resource they own
 * (`resourceOwnerUserId === membership.userId`). Defense-in-depth over the RLS
 * own-scope: the server action refuses a cross-owner write even before the
 * database policy would.
 */
export function canActOnOwnedResource(
  membership: Membership,
  resourceOwnerUserId: string,
): boolean {
  return operatesFrontDesk(membership) || resourceOwnerUserId === membership.userId
}
