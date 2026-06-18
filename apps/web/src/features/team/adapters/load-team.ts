import {
  Membership,
  ROLE_SUBJECT_NOUN,
  StoredProfessional,
  User,
  resolveSubjectName,
  type Invite,
  type OperationalStatus,
} from '@/domain'
import { getAdminFirestore } from '@/shared/db'
import { decodeAs, fsConverter } from '@/shared/db/converter'
import { getSessionUser } from '@/shared/firebase/admin'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { filterBySearch } from '@/shared/list/filter-by-search'
import { resolveListSurfaceState, type ListSurfaceState } from '@/shared/list/list-page-state'
import { listInvitesForOrg } from '@/shared/org/invite-read'
import { getActiveOrgContext } from '@/shared/org/membership'
import { redirect } from 'next/navigation'
import 'server-only'

// A team list entry — either an accepted member (membership) or a still-pending
// invitation. The two render differently but share one filterable, paginated
// list (the old Members/Invites tabs collapsed into a single `view` filter).
export type TeamEntry = { kind: 'member'; member: Membership } | { kind: 'invite'; invite: Invite }

export type TeamViewFilter = 'all' | 'active' | 'pending'

export type TeamPageData = {
  canManage: boolean
  currentUserId: string
  entries: TeamEntry[]
  displayNameByUserId: Record<string, string>
  whatsappByUserId: Record<string, string>
  birthDateByUserId: Record<string, string>
  // Derived professional operational status (#1047), keyed by userId — surfaced
  // on the list so a professional whose profile is still incomplete (not
  // operational → not bookable) is visibly distinct from an operational one,
  // not just "Ativo".
  operationalByUserId: Record<string, OperationalStatus>
  viewFilter: TeamViewFilter
  pendingCount: number
  searchQuery: string
  state: ListSurfaceState
}

function normalizeViewFilter(value: string | undefined): TeamViewFilter {
  return value === 'active' || value === 'pending' ? value : 'all'
}

// Resolve each member's identity (display name + WhatsApp) from the live `User`
// doc (brief 0028 #1046), batched by userId. Anonymized accounts (LGPD #1095)
// resolve to the neutral `‹Role› ‹CODE›` keyed by role; the CUSTOMER per-org
// block is NOT applied — team is the employment relationship, retained
// identifiable (art. 16). WhatsApp is only mapped when present on the User.
async function loadMemberIdentities(
  db: ReturnType<typeof getAdminFirestore>,
  members: Membership[],
): Promise<{
  displayNameByUserId: Record<string, string>
  whatsappByUserId: Record<string, string>
  birthDateByUserId: Record<string, string>
}> {
  const userIds = [...new Set(members.map((m) => m.userId).filter(Boolean))]
  const userRefs = userIds.map((uid) => db.collection('users').doc(uid))
  const userSnaps = userRefs.length > 0 ? await db.getAll(...userRefs) : []
  const userByUserId = new Map<string, User>()
  for (const snap of userSnaps) {
    const raw = snap.data()
    if (raw) userByUserId.set(snap.id, decodeAs(User, raw))
  }
  const displayNameByUserId: Record<string, string> = {}
  const whatsappByUserId: Record<string, string> = {}
  const birthDateByUserId: Record<string, string> = {}
  for (const m of members) {
    if (!m.userId) continue
    const user = userByUserId.get(m.userId)
    const resolved = resolveSubjectName(m.userId, user, ROLE_SUBJECT_NOUN[m.role])
    if (resolved) displayNameByUserId[m.userId] = resolved
    if (user?.whatsapp) whatsappByUserId[m.userId] = user.whatsapp
    if (user?.birthDate) birthDateByUserId[m.userId] = user.birthDate
  }
  return { displayNameByUserId, whatsappByUserId, birthDateByUserId }
}

// Imperative shell for the team list route: resolves session/org, loads the
// (non-revoked) memberships + their display names + pending invites, and returns
// the typed view-model the route renders. page.tsx stays a thin caller.
export async function loadTeamPage(
  rawParams: { q?: string; view?: string } = {},
): Promise<TeamPageData> {
  if (!isFirebaseConfigured()) redirect('/')

  const session = await getSessionUser()
  if (!session) redirect('/login')

  const ctx = await getActiveOrgContext(session.uid)
  if (!ctx) redirect('/onboarding')

  const canManage = ctx.membership.role === 'owner' || ctx.membership.role === 'manager'
  const searchQuery = rawParams.q ?? ''
  // Non-managers can't see invites, so they're pinned to the members view.
  const viewFilter: TeamViewFilter = canManage ? normalizeViewFilter(rawParams.view) : 'active'

  const db = getAdminFirestore()
  const orgId = ctx.membership.orgId

  const [membersSnap, invites, profsSnap] = await Promise.all([
    db
      .collection('memberships')
      .where('orgId', '==', orgId)
      .withConverter(fsConverter(Membership))
      .get(),
    // PII (invitee email) merged from `invites_pii` on read (#1036).
    canManage ? listInvitesForOrg(orgId) : Promise.resolve<Invite[]>([]),
    // Professional projections carry the DERIVED `operationalStatus` (#1047); we
    // only need the status per userId, so read the projection directly (no PII
    // enrichment — name/whatsapp already come from the User above).
    db
      .collection('orgs')
      .doc(orgId)
      .collection('professionals')
      .withConverter(fsConverter(StoredProfessional))
      .get(),
  ])

  const operationalByUserId: Record<string, OperationalStatus> = {}
  for (const doc of profsSnap.docs) {
    const pro = doc.data()
    if (pro.userId) operationalByUserId[pro.userId] = pro.operationalStatus
  }

  // Offboarded members (brief 0041 #1103, AC-10) carry the terminal `revoked`
  // status — they've lost access and must drop from the active team surface.
  // The vínculo data is retained identifiable in Firestore (art. 16); it just
  // no longer appears on this active listing.
  const allMembers = membersSnap.docs.map((d) => d.data()).filter((m) => m.status !== 'revoked')
  const pendingInvites = invites.filter((i) => i.status === 'pending')
  const pendingCount = pendingInvites.length

  // Identities resolved over the full set so search can match display names.
  const { displayNameByUserId, whatsappByUserId, birthDateByUserId } = await loadMemberIdentities(
    db,
    allMembers,
  )

  // Members + pending invites collapse into one filterable list (the old tabs).
  const memberEntries: TeamEntry[] = allMembers.map((member) => ({ kind: 'member', member }))
  const inviteEntries: TeamEntry[] = pendingInvites.map((invite) => ({ kind: 'invite', invite }))
  let viewEntries: TeamEntry[]
  if (viewFilter === 'active') viewEntries = memberEntries
  else if (viewFilter === 'pending') viewEntries = inviteEntries
  else viewEntries = [...memberEntries, ...inviteEntries]

  // Search matches a member's display name or an invite's email.
  const entries = filterBySearch(viewEntries, searchQuery, (entry) =>
    entry.kind === 'member' ? [displayNameByUserId[entry.member.userId]] : [entry.invite.email],
  )

  const state = resolveListSurfaceState({
    hasAnyData: allMembers.length + pendingInvites.length > 0,
    visibleCount: entries.length,
  })

  return {
    canManage,
    currentUserId: session.uid,
    entries,
    displayNameByUserId,
    whatsappByUserId,
    birthDateByUserId,
    operationalByUserId,
    viewFilter,
    pendingCount,
    searchQuery,
    state,
  }
}
