import type { AgendaBlock } from '@/domain'
import {
  type CatalogServiceItem,
  type Membership,
  ROLE_SUBJECT_NOUN,
  type StoredUnit,
  isCatalogService,
  resolveSubjectName,
} from '@/domain'
import { listCatalogItems } from '@/shared/db/effect/catalog-item-read'
import { getSessionUser } from '@/shared/firebase/admin'
import { listAgendaBlocksByMemberOperationId } from '@/shared/org/agenda-block-read'
import { getMemberOperationByUserId } from '@/shared/org/member-operation-read'
import { getActiveOrgContext, getMembership, getUserDoc } from '@/shared/org/membership'
import { listUnitsForOrg } from '@/shared/org/unit-read'
import { notFound, redirect } from 'next/navigation'
import 'server-only'

export type MemberOperationEditContext = {
  memberOperation: NonNullable<Awaited<ReturnType<typeof getMemberOperationByUserId>>>
  units: StoredUnit[]
  services: CatalogServiceItem[]
}

type MemberOperationEditData = {
  memberOperationEdit: MemberOperationEditContext | null
  memberOperationBlocks: AgendaBlock[]
  memberOperationUnits: StoredUnit[]
  orgTimezone: string
}

export type MemberDetailData = {
  member: Membership
  displayName: string
  memberEmail: string
  memberWhatsapp: string
  isMemberOperator: boolean
  isReadOnly: boolean
  canToggleStatus: boolean
  canRemove: boolean
} & MemberOperationEditData

const EMPTY_MEMBER_OPERATION_EDIT: MemberOperationEditData = {
  memberOperationEdit: null,
  memberOperationBlocks: [],
  memberOperationUnits: [],
  orgTimezone: 'America/Sao_Paulo',
}

// Operational edit context for a memberOperation member (AC-02): the projection +
// the org's units/services for the form, plus this memberOperation's own agenda
// blocks (brief 0036 #1082). Only called when the member is a memberOperation.
async function loadMemberOperationEditContext(
  orgId: string,
  userId: string,
): Promise<MemberOperationEditData> {
  const [memberOperation, units, catalogItems] = await Promise.all([
    getMemberOperationByUserId(orgId, userId),
    // Ordered by name under RLS; enriched `Unit` is assignable to `StoredUnit`
    // (the extra PII fields are unused here).
    listUnitsForOrg(orgId),
    listCatalogItems(orgId),
  ])
  // Timezone is the establishment's (PRD Identidade v2 — moved Org→Unit): the
  // member-detail agenda uses the first unit's tz (org-scoped view; per-unit
  // blocks render in that unit's tz).
  const orgTimezone = units[0]?.timezone ?? EMPTY_MEMBER_OPERATION_EDIT.orgTimezone
  if (!memberOperation) return { ...EMPTY_MEMBER_OPERATION_EDIT, orgTimezone }
  // Unified catalog (brief 0023, #1004 → 0053/B3): kind-service items directly.
  const services = catalogItems.filter(isCatalogService)
  // The memberOperation operates in a subset of units; a block applies to one of
  // them. Equality-only query → no composite index; sort in-memory.
  const memberOperationUnits = units.filter((u) => memberOperation.unitIds.includes(u.id))
  // Backend-aware read (Postgres typed table under RLS / Firestore subcollection);
  // equality-only query → no composite index, sort in-memory by recency.
  const memberOperationBlocks = (
    await listAgendaBlocksByMemberOperationId(orgId, memberOperation.id)
  ).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  return {
    memberOperationEdit: { memberOperation, units, services },
    memberOperationBlocks,
    memberOperationUnits,
    orgTimezone,
  }
}

// Imperative shell for the member-detail route: gates owner/manager access,
// loads the membership + live user identity + (for memberOperations) the
// operational edit context, and derives the read-only/toggle/remove affordances.
// Returns the typed view-model the route renders. page.tsx stays a thin caller.
export async function loadMemberDetailPage(userId: string): Promise<MemberDetailData> {
  const session = await getSessionUser()
  if (!session) redirect('/login')
  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) redirect('/onboarding')

  const canManage = ctx.membership.role === 'owner' || ctx.membership.role === 'manager'
  if (!canManage) redirect('/team')

  const orgId = ctx.membership.orgId

  const member = await getMembership(orgId, userId)
  if (!member) notFound()

  const user = await getUserDoc(userId)
  // Anonymized accounts (LGPD #1095, AC-03) resolve to the neutral `‹Role›
  // ‹CODE›` keyed by the member's role. The CUSTOMER per-org block
  // (#1096/#1100) is NOT applied here: member detail is the memberOperation/
  // employment relationship (brief 0032 re-scope 04/06), retained IDENTIFIABLE
  // (art. 16) — a member blocked as a customer keeps their real name + contact
  // here. Its severance is offboarding (brief 0041), not customer erasure.
  const displayName =
    resolveSubjectName(userId, user ?? undefined, ROLE_SUBJECT_NOUN[member.role]) ||
    '(membro sem dados)'
  const memberEmail = user?.email ?? ''
  const memberWhatsapp = user?.whatsapp ?? ''

  const isMemberOperator = member.role === 'member_operator'
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

  // Operational edit context — only loaded for memberOperation members (AC-02).
  const memberOperationData = isMemberOperator
    ? await loadMemberOperationEditContext(orgId, userId)
    : EMPTY_MEMBER_OPERATION_EDIT

  return {
    member,
    displayName,
    memberEmail,
    memberWhatsapp,
    isMemberOperator,
    isReadOnly,
    canToggleStatus,
    canRemove,
    ...memberOperationData,
  }
}
