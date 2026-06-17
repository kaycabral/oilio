import {
  AgendaBlock,
  CatalogItem,
  Membership,
  ROLE_SUBJECT_NOUN,
  StoredUnit,
  catalogServiceToService,
  isCatalogService,
  membershipDocId,
  resolveSubjectName,
} from '@/domain'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import { getSessionUser } from '@/shared/firebase/admin'
import { getActiveTenantContext, getUserDoc } from '@/shared/tenant/membership'
import { getProfessionalByUserId } from '@/shared/tenant/professional-read'
import { getTenant } from '@/shared/tenant/tenant'
import { notFound, redirect } from 'next/navigation'
import 'server-only'

export type ProfessionalEditContext = {
  professional: NonNullable<Awaited<ReturnType<typeof getProfessionalByUserId>>>
  units: StoredUnit[]
  services: ReturnType<typeof catalogServiceToService>[]
}

type ProfessionalEditData = {
  professionalEdit: ProfessionalEditContext | null
  professionalBlocks: AgendaBlock[]
  professionalUnits: StoredUnit[]
  tenantTimezone: string
}

export type MemberDetailData = {
  member: Membership
  displayName: string
  memberEmail: string
  memberWhatsapp: string
  isProfessional: boolean
  isReadOnly: boolean
  canToggleStatus: boolean
  canRemove: boolean
} & ProfessionalEditData

const EMPTY_PROFESSIONAL_EDIT: ProfessionalEditData = {
  professionalEdit: null,
  professionalBlocks: [],
  professionalUnits: [],
  tenantTimezone: 'America/Sao_Paulo',
}

// Operational edit context for a professional member (AC-02): the projection +
// the tenant's units/services for the form, plus this professional's own agenda
// blocks (brief 0036 #1082). Only called when the member is a professional.
async function loadProfessionalEditContext(
  tenantId: string,
  userId: string,
): Promise<ProfessionalEditData> {
  const db = getAdminFirestore()
  const tenantRef = db.collection('tenants').doc(tenantId)
  const [professional, unitSnap, servicesSnap, tenant] = await Promise.all([
    getProfessionalByUserId(tenantId, userId),
    tenantRef.collection('units').orderBy('name').withConverter(fsConverter(StoredUnit)).get(),
    tenantRef
      .collection('catalog_items')
      .orderBy('name')
      .withConverter(fsConverter(CatalogItem))
      .get(),
    getTenant(tenantId),
  ])
  const tenantTimezone = tenant?.timezone ?? EMPTY_PROFESSIONAL_EDIT.tenantTimezone
  if (!professional) return { ...EMPTY_PROFESSIONAL_EDIT, tenantTimezone }

  const units = unitSnap.docs.map((d) => d.data())
  // Unified catalog (brief 0023, #1004): kind service only, adapted to Service.
  const services = servicesSnap.docs
    .map((d) => d.data())
    .filter(isCatalogService)
    .map(catalogServiceToService)
  // The professional operates in a subset of units; a block applies to one of
  // them. Equality-only query → no composite index; sort in-memory.
  const professionalUnits = units.filter((u) => professional.unitIds.includes(u.id))
  const blocksSnap = await tenantRef
    .collection('agenda_blocks')
    .where('professionalId', '==', professional.id)
    .withConverter(fsConverter(AgendaBlock))
    .get()
  const professionalBlocks = blocksSnap.docs
    .map((d) => ({ ...d.data(), id: d.id }))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  return {
    professionalEdit: { professional, units, services },
    professionalBlocks,
    professionalUnits,
    tenantTimezone,
  }
}

// Imperative shell for the member-detail route: gates owner/manager access,
// loads the membership + live user identity + (for professionals) the
// operational edit context, and derives the read-only/toggle/remove affordances.
// Returns the typed view-model the route renders. page.tsx stays a thin caller.
export async function loadMemberDetailPage(userId: string): Promise<MemberDetailData> {
  const session = await getSessionUser()
  if (!session) redirect('/login')
  const ctx = await getActiveTenantContext(session.uid)
  if (!ctx) redirect('/onboarding')

  const canManage = ctx.membership.role === 'owner' || ctx.membership.role === 'manager'
  if (!canManage) redirect('/team')

  const tenantId = ctx.membership.tenantId
  const db = getAdminFirestore()

  const memberSnap = await db
    .collection('memberships')
    .withConverter(fsConverter(Membership))
    .doc(membershipDocId(tenantId, userId))
    .get()
  const member = memberSnap.data()
  if (!member) notFound()

  const user = await getUserDoc(userId)
  // Anonymized accounts (LGPD #1095, AC-03) resolve to the neutral `‹Role›
  // ‹CODE›` keyed by the member's role. The CUSTOMER per-tenant block
  // (#1096/#1100) is NOT applied here: member detail is the professional/
  // employment relationship (brief 0032 re-scope 04/06), retained IDENTIFIABLE
  // (art. 16) — a member blocked as a customer keeps their real name + contact
  // here. Its severance is offboarding (brief 0041), not customer erasure.
  const displayName =
    resolveSubjectName(userId, user ?? undefined, ROLE_SUBJECT_NOUN[member.role]) ||
    '(membro sem dados)'
  const memberEmail = user?.email ?? ''
  const memberWhatsapp = user?.whatsapp ?? ''

  const isProfessional = member.role === 'professional'
  // The owner is never editable (immutable identity, refino), and a manager
  // can't change their own role — both render read-only (no role select, no
  // Salvar). Everyone else gets the single editable form.
  const isReadOnly = member.role === 'owner' || member.userId === session.uid

  // Deactivate/reactivate (brief 0029 #1053, AC-10) is available for any member
  // that isn't the owner (immutable identity) nor the viewer's own membership
  // (no self-lockout) — same guards as the action. Only the active↔suspended
  // pair is toggleable here (invited/revoked are out of scope).
  const canToggleStatus =
    member.role !== 'owner' &&
    member.userId !== session.uid &&
    (member.status === 'active' || member.status === 'suspended')

  // Offboarding (brief 0041 #1103, AC-01/AC-10) — the establishment's unified
  // "remover do time": terminal severance ending access, distinct from the
  // reversible deactivate toggle above. Available for any non-owner member that
  // isn't the viewer themselves (no self-lockout) and isn't already revoked
  // (idempotent — same guards as the action).
  const canRemove =
    member.role !== 'owner' && member.userId !== session.uid && member.status !== 'revoked'

  // Operational edit context — only loaded for professional members (AC-02).
  const professionalData = isProfessional
    ? await loadProfessionalEditContext(tenantId, userId)
    : EMPTY_PROFESSIONAL_EDIT

  return {
    member,
    displayName,
    memberEmail,
    memberWhatsapp,
    isProfessional,
    isReadOnly,
    canToggleStatus,
    canRemove,
    ...professionalData,
  }
}
