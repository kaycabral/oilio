import {
  Membership,
  ROLE_SUBJECT_NOUN,
  User,
  canManageTenant,
  membershipDocId,
  resolveSubjectName,
  type Role,
} from '@/domain'
import { getAdminFirestore } from '@/shared/db'
import { decodeAs, fsConverter } from '@/shared/db/converter'
import { getSessionUser, type SessionUser } from '@/shared/firebase/admin'
import { Schema } from 'effect'
import 'server-only'

// Minimal projection — the tenant switcher only needs the business name.
const TenantNameProbe = Schema.Struct({ name: Schema.optional(Schema.String) })

export type TenantContext = {
  user: User
  membership: Membership
}

export async function getUserDoc(uid: string): Promise<User | null> {
  const snap = await getAdminFirestore()
    .collection('users')
    .doc(uid)
    .withConverter(fsConverter(User))
    .get()
  const data = snap.data()
  if (!data) return null
  return { ...data, uid }
}

export async function getMembership(tenantId: string, uid: string): Promise<Membership | null> {
  const snap = await getAdminFirestore()
    .collection('memberships')
    .doc(membershipDocId(tenantId, uid))
    .withConverter(fsConverter(Membership))
    .get()
  return snap.data() ?? null
}

export async function getUserMemberships(uid: string): Promise<Membership[]> {
  const snap = await getAdminFirestore()
    .collection('memberships')
    .where('userId', '==', uid)
    .where('status', '==', 'active')
    .withConverter(fsConverter(Membership))
    .get()
  return snap.docs.map((d) => d.data())
}

// A member operável de um tenant, identificado pelo `userId` global (brief 0030,
// AC-04). Usado pra atribuir item a um membro: o select de "Executor/Vendedor"
// lista estes e grava o `userId` em `OrderItem.attributedUserId`. Nome vem LIVE
// do doc `users/` (#1046), não da membership.
export type TenantMember = {
  userId: string
  name: string
  role: Role
  // Null = membership escopada ao tenant; non-null = travada numa unidade.
  unitId: string | null
}

/**
 * Membros operáveis de um tenant (brief 0030, AC-04): memberships ativas com
 * papel operacional (exclui `customer`), enriquecidas com o displayName LIVE do
 * `users/`. É a fonte do controle de atribuição por membro — qualquer membro
 * (recepção inclusa), não só Professional. Ordenado por nome. Sem cross-tenant
 * query: filtra por `tenantId` na coleção top-level `memberships`.
 */
export async function listTenantMembers(tenantId: string): Promise<TenantMember[]> {
  const db = getAdminFirestore()
  const snap = await db
    .collection('memberships')
    .where('tenantId', '==', tenantId)
    .where('status', '==', 'active')
    .withConverter(fsConverter(Membership))
    .get()
  const memberships = snap.docs
    .map((d) => d.data())
    .filter((m) => m.role !== 'customer' && Boolean(m.userId))
  const userIds = [...new Set(memberships.map((m) => m.userId))]
  const userRefs = userIds.map((uid) => db.collection('users').doc(uid))
  const userSnaps = userRefs.length > 0 ? await db.getAll(...userRefs) : []
  const userByUserId = new Map<string, User>()
  for (const s of userSnaps) {
    const raw = s.data()
    if (!raw) continue
    userByUserId.set(s.id, decodeAs(User, raw))
  }
  return memberships
    .map((m) => {
      // Anonymized accounts (LGPD #1095, AC-03) resolve to the neutral label
      // `‹Role› ‹CODE›` keyed by the member's role (Profissional / Recepção …).
      //
      // The CUSTOMER per-tenant block (#1096/#1100) is NOT applied here: members
      // are the professional/employment relationship (brief 0032 re-scope 04/06),
      // retained IDENTIFIABLE (art. 16). A person blocked as a customer in this
      // tenant still shows their real name on the team/commissions surfaces.
      const resolved = resolveSubjectName(
        m.userId,
        userByUserId.get(m.userId),
        ROLE_SUBJECT_NOUN[m.role],
      )
      return {
        userId: m.userId,
        name: resolved || '(membro sem nome)',
        role: m.role,
        unitId: m.unitId ?? null,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }))
}

export type TenantOption = { id: string; name: string }

/**
 * Tenants the user is an active member of, with their display name (brief 0029,
 * AC-09). Drives the tenant switcher — shown only when length >= 2. Reads each
 * tenant doc by id (no cross-tenant query); a missing/unreadable tenant is
 * skipped so a dangling membership never breaks the switcher.
 */
export async function listAccessibleTenants(uid: string): Promise<TenantOption[]> {
  const memberships = await getUserMemberships(uid)
  const db = getAdminFirestore()
  const tenants = await Promise.all(
    memberships.map(async (m) => {
      const snap = await db
        .collection('tenants')
        .doc(m.tenantId)
        .withConverter(fsConverter(TenantNameProbe))
        .get()
      if (!snap.exists) return null
      const name = snap.data()?.name
      return { id: m.tenantId, name: name ?? m.tenantId }
    }),
  )
  return tenants
    .filter((t): t is TenantOption => t !== null)
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function getActiveTenantContext(uid: string): Promise<TenantContext | null> {
  const user = await getUserDoc(uid)
  if (!user || !user.currentTenantId) return null
  const membership = await getMembership(user.currentTenantId, uid)
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
      `Role ${membership.role} not in allowed set [${allowed.join(', ')}] for tenant ${membership.tenantId}`,
    )
  }
}

export function assertCanManage(membership: Membership): void {
  if (!canManageTenant(membership.role)) {
    throw new AuthzError(`Role ${membership.role} cannot manage tenant ${membership.tenantId}`)
  }
}

export type RequiredTenantCtx = TenantContext & { session: SessionUser }

/**
 * Resolves session + tenant context in one shot for server actions / route handlers.
 * Returns a discriminated union — server actions can early-return the error result.
 */
export type RequireCtxResult = { ok: true; ctx: RequiredTenantCtx } | { ok: false; error: string }

export async function requireTenantCtx(): Promise<RequireCtxResult> {
  const session = await getSessionUser()
  if (!session) return { ok: false, error: 'Not signed in' }
  if (!session.emailVerified) return { ok: false, error: 'Email not verified' }
  const ctx = await getActiveTenantContext(session.uid)
  if (!ctx) return { ok: false, error: 'No active tenant' }
  return { ok: true, ctx: { ...ctx, session } }
}

export async function requireManagerCtx(): Promise<RequireCtxResult> {
  const base = await requireTenantCtx()
  if (!base.ok) return base
  if (!canManageTenant(base.ctx.membership.role)) {
    return { ok: false, error: 'Permission denied (owner or manager required)' }
  }
  return base
}

export async function requireOwnerCtx(): Promise<RequireCtxResult> {
  const base = await requireTenantCtx()
  if (!base.ok) return base
  if (base.ctx.membership.role !== 'owner') {
    return { ok: false, error: 'Permission denied (owner required)' }
  }
  return base
}
