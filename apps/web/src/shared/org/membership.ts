import {
  canManageOrg,
  Membership,
  membershipDocId,
  resolveSubjectName,
  ROLE_SUBJECT_NOUN,
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

// The user ids whose membership is CURRENTLY active AND role `professional` —
// the set that legitimately backs a `professionals` projection row right now.
// The projection and the role can diverge (a demoted member keeps a lingering
// row for reversibility; a seed could insert one for a non-professional), so
// operational surfaces (the agenda) cross-check the projection against THIS set
// to decide who is bookable. Keyed on CURRENT state — never history — so a
// later promotion (receptionist→professional) re-includes the user with no
// special-casing, and a demotion drops them. Reads the typed table under RLS.
export async function listActiveProfessionalUserIds(orgId: string): Promise<Set<string>> {
  const rows = await readUnderRls<{ user_id: string }>(orgId, (client) =>
    client
      .query<{
        user_id: string
      }>(
        "SELECT user_id FROM memberships WHERE org_id = $1 AND status = 'active' AND role = 'professional'",
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
