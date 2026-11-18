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
import { isAuthConfigured } from '@/shared/auth/config'
import { getSessionUser, type SessionUser } from '@/shared/auth/session'
import { rowToDoc, type MembershipRow } from '@/shared/db/pg/effect/membership-projector'
import { getPublicOrgNamesByIds } from '@/shared/db/pg/public-org-directory'
import { readAsSubject, readUnderRls } from '@/shared/db/pg/rls-read'
import { getUserById, getUsersByIds } from '@/shared/db/pg/users-store'
import { track } from '@/shared/lib/track'
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

export type OrgMember = {
  userId: string
  name: string
  role: Role
  rlsUnitScope: string | null
}

export async function listActiveOrgMemberships(orgId: string): Promise<Membership[]> {
  const rows = await readUnderRls<MembershipRow>(orgId, (client) =>
    client
      .query<MembershipRow>("SELECT * FROM memberships WHERE org_id = $1 AND status = 'active'", [
        orgId,
      ])
      .then((res) => res.rows),
  )
  return rows.map((r) => decodeMembership(rowToDoc(r)))
}

export async function listMembershipsForOrg(orgId: string): Promise<Membership[]> {
  const rows = await readUnderRls<MembershipRow>(orgId, (client) =>
    client
      .query<MembershipRow>('SELECT * FROM memberships WHERE org_id = $1', [orgId])
      .then((res) => res.rows),
  )
  return rows.map((r) => decodeMembership(rowToDoc(r)))
}

export async function listOrgMembers(orgId: string): Promise<OrgMember[]> {
  const memberships = (await listActiveOrgMemberships(orgId)).filter((m) => Boolean(m.userId))
  const userByUserId = await getUsersByIds(memberships.map((m) => m.userId))
  return memberships
    .map((m) => {
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

export async function requireManagerPage(notManagerTo: Route = '/agenda'): Promise<RequiredOrgCtx> {
  if (!isAuthConfigured()) redirect('/')
  const session = await getSessionUser()
  if (!session) redirect('/login')
  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) redirect('/onboarding')
  if (!canManageOrg(ctx.membership.role)) redirect(notManagerTo)
  return { ...ctx, session }
}

export async function requireCapabilityPage(
  capability: MembershipCapability,
  notAllowedTo: Route = '/agenda',
): Promise<RequiredOrgCtx> {
  if (!isAuthConfigured()) redirect('/')
  const session = await getSessionUser()
  if (!session) redirect('/login')
  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) redirect('/onboarding')
  if (!hasMembershipCapability(ctx.membership, capability)) redirect(notAllowedTo)
  return { ...ctx, session }
}

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

export async function requireRecurringManagerCtx(): Promise<RequireCtxResult> {
  const r = await requireManagerCtx()
  if (!r.ok) return r
  return assertRecurringTier(r)
}

export async function requireRecurringOwnerCtx(): Promise<RequireCtxResult> {
  const r = await requireOwnerCtx()
  if (!r.ok) return r
  return assertRecurringTier(r)
}

async function assertRecurringTier(r: {
  ok: true
  ctx: RequiredOrgCtx
}): Promise<RequireCtxResult> {
  const tier = await getOrgTier(r.ctx.membership.orgId)
  if (!hasCapability(tier, 'plans.recurring')) {
    track('capability_denied', {
      org_id: r.ctx.membership.orgId,
      user_id: r.ctx.session.uid,
      capability: 'plans.recurring',
      surface: 'action',
      verb: 'mutate',
    })
    return {
      ok: false,
      error: 'Planos e assinaturas estão disponíveis no plano Pro. Faça upgrade para continuar.',
    }
  }
  return r
}

export type MembershipCapability = keyof MembershipPermissions

export function hasMembershipCapability(
  membership: Membership,
  capability: MembershipCapability,
): boolean {
  return membership.permissions[capability]
}

export async function guardCapability(capability: MembershipCapability): Promise<RequireCtxResult> {
  const base = await requireOrgCtx()
  if (!base.ok) return base
  if (!hasMembershipCapability(base.ctx.membership, capability)) {
    return { ok: false, error: `Permission denied (${capability} required)` }
  }
  return base
}

export function operatesFrontDesk(membership: Membership): boolean {
  return canManageOrg(membership.role) || hasMembershipCapability(membership, 'canManageCustomers')
}

export function canActOnOwnedResource(
  membership: Membership,
  resourceOwnerUserId: string,
): boolean {
  return operatesFrontDesk(membership) || resourceOwnerUserId === membership.userId
}
