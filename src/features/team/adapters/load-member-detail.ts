import type { AgendaBlock } from '@/domain'
import {
  type CatalogServiceItem,
  type Membership,
  ROLE_SUBJECT_NOUN,
  type StoredUnit,
  isCatalogService,
  resolveSubjectName,
} from '@/domain'
import { getSessionUser } from '@/shared/auth/session'
import { listCatalogItems } from '@/shared/db/effect/catalog-item-read'
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

async function loadMemberOperationEditContext(
  orgId: string,
  userId: string,
): Promise<MemberOperationEditData> {
  const [memberOperation, units, catalogItems] = await Promise.all([
    getMemberOperationByUserId(orgId, userId),
    listUnitsForOrg(orgId),
    listCatalogItems(orgId),
  ])
  const orgTimezone = units[0]?.timezone ?? EMPTY_MEMBER_OPERATION_EDIT.orgTimezone
  if (!memberOperation) return { ...EMPTY_MEMBER_OPERATION_EDIT, orgTimezone }
  const services = catalogItems.filter(isCatalogService)
  const memberOperationUnits = units.filter((u) => memberOperation.unitIds.includes(u.id))
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
  const displayName =
    resolveSubjectName(userId, user ?? undefined, ROLE_SUBJECT_NOUN[member.role]) ||
    '(membro sem dados)'
  const memberEmail = user?.email ?? ''
  const memberWhatsapp = user?.mobile ?? ''

  const isMemberOperator = member.role === 'member_operator'
  const isReadOnly = member.role === 'owner' || member.userId === session.uid

  const canToggleStatus =
    member.role !== 'owner' &&
    member.userId !== session.uid &&
    (member.status === 'active' || member.status === 'suspended')

  const canRemove =
    member.role !== 'owner' && member.userId !== session.uid && member.status !== 'revoked'

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
