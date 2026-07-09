import type { Membership } from '@/domain'
import {
  ROLE_SUBJECT_NOUN,
  resolveSubjectName,
  type Invite,
  type OperationalStatus,
} from '@/domain'
import { getUsersByIds } from '@/shared/db/pg/users-store'
import { filterBySearch } from '@/shared/list/filter-by-search'
import { resolveListSurfaceState, type ListSurfaceState } from '@/shared/list/list-page-state'
import { listInvitesForOrg } from '@/shared/org/invite-read'
import { listMemberOperationStatuses } from '@/shared/org/member-operation-read'
import { listMembershipsForOrg, requireManagerPage } from '@/shared/org/membership'
import { resolveBaseUrl } from '@/shared/site-url'
import 'server-only'

export type TeamEntry = { kind: 'member'; member: Membership } | { kind: 'invite'; invite: Invite }

export type TeamViewFilter = 'all' | 'active' | 'pending'

export type TeamPageData = {
  canManage: boolean
  currentUserId: string
  orgId: string
  baseUrl: string
  entries: TeamEntry[]
  displayNameByUserId: Record<string, string>
  mobileByUserId: Record<string, string>
  birthDateByUserId: Record<string, string>
  operationalByUserId: Record<string, OperationalStatus>
  viewFilter: TeamViewFilter
  pendingCount: number
  searchQuery: string
  state: ListSurfaceState
}

function normalizeViewFilter(value: string | undefined): TeamViewFilter {
  return value === 'active' || value === 'pending' ? value : 'all'
}

async function loadMemberIdentities(members: Membership[]): Promise<{
  displayNameByUserId: Record<string, string>
  mobileByUserId: Record<string, string>
  birthDateByUserId: Record<string, string>
}> {
  const userByUserId = await getUsersByIds(members.map((m) => m.userId))
  const displayNameByUserId: Record<string, string> = {}
  const mobileByUserId: Record<string, string> = {}
  const birthDateByUserId: Record<string, string> = {}
  for (const m of members) {
    if (!m.userId) continue
    const user = userByUserId.get(m.userId)
    const resolved = resolveSubjectName(m.userId, user, ROLE_SUBJECT_NOUN[m.role])
    if (resolved) displayNameByUserId[m.userId] = resolved
    if (user?.mobile) mobileByUserId[m.userId] = user.mobile
    if (user?.birthDate) birthDateByUserId[m.userId] = user.birthDate
  }
  return { displayNameByUserId, mobileByUserId, birthDateByUserId }
}

export async function loadTeamPage(
  rawParams: { q?: string; view?: string } = {},
): Promise<TeamPageData> {
  const ctx = await requireManagerPage()

  const searchQuery = rawParams.q ?? ''
  const viewFilter: TeamViewFilter = normalizeViewFilter(rawParams.view)

  const orgId = ctx.membership.orgId
  const baseUrl = await resolveBaseUrl()

  const [allMemberships, invites, memberOperations] = await Promise.all([
    listMembershipsForOrg(orgId),
    listInvitesForOrg(orgId),
    listMemberOperationStatuses(orgId),
  ])

  const operationalByUserId: Record<string, OperationalStatus> = {}
  for (const pro of memberOperations) {
    if (pro.userId) operationalByUserId[pro.userId] = pro.operationalStatus
  }

  const allMembers = allMemberships.filter((m) => m.status !== 'revoked')
  const pendingInvites = invites.filter((i) => i.status === 'pending')
  const pendingCount = pendingInvites.length

  const { displayNameByUserId, mobileByUserId, birthDateByUserId } =
    await loadMemberIdentities(allMembers)

  const memberEntries: TeamEntry[] = allMembers.map((member) => ({ kind: 'member', member }))
  const inviteEntries: TeamEntry[] = pendingInvites.map((invite) => ({ kind: 'invite', invite }))
  let viewEntries: TeamEntry[]
  if (viewFilter === 'active') viewEntries = memberEntries
  else if (viewFilter === 'pending') viewEntries = inviteEntries
  else viewEntries = [...memberEntries, ...inviteEntries]

  const entries = filterBySearch(viewEntries, searchQuery, (entry) =>
    entry.kind === 'member' ? [displayNameByUserId[entry.member.userId]] : [entry.invite.mobile],
  )

  const state = resolveListSurfaceState({
    hasAnyData: allMembers.length + pendingInvites.length > 0,
    visibleCount: entries.length,
  })

  return {
    canManage: true,
    currentUserId: ctx.session.uid,
    orgId,
    baseUrl,
    entries,
    displayNameByUserId,
    mobileByUserId,
    birthDateByUserId,
    operationalByUserId,
    viewFilter,
    pendingCount,
    searchQuery,
    state,
  }
}
