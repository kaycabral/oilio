// Team-seat quota helper — extracted from the 'use server' actions module so it
// is NOT exposed as a callable server action (a `'use server'` export becomes a
// POST-reachable action; this is an internal read-side guard, not an action).

import { hasCapability } from '@/domain/billing/capabilities'
import { getOrgTier } from '@/shared/org/billing-read'
import { listInvitesByStatus } from '@/shared/org/invite-read'
import { listActiveOrgMemberships } from '@/shared/org/membership'

// The Free tier's team is "você + 1" — the owner plus one member, 2 seats total.
export const FREE_TEAM_SEAT_LIMIT = 2

// The team-seat quota wall (brief 0089; feature-pai 0072). Free allows "você + 1"
// (2 seats); a third seat requires `team.unlimited` (Pro+). Returns an error
// string when the quota is reached, or `null` when the org may add one more.
//
// Anti-TOCTOU (AC-02): the count sums ACTIVE memberships AND pending, non-expired
// invites — otherwise an owner could mint N parallel invites (each below the cap
// at issue time) and blow past "você + 1" once they all accept. A `pending`
// invite past its TTL frees its seat back (the invitee can no longer accept it).
// Mirrors `assertActiveUnitQuota` (units-quota.ts).
export async function assertTeamSeatQuota(orgId: string): Promise<string | null> {
  const tier = await getOrgTier(orgId)
  if (hasCapability(tier, 'team.unlimited')) return null

  const now = Date.now()
  const [activeMembers, pendingInvites] = await Promise.all([
    listActiveOrgMemberships(orgId),
    listInvitesByStatus(orgId, 'pending'),
  ])
  const livePendingInvites = pendingInvites.filter(
    (invite) => new Date(invite.expiresAt).getTime() > now,
  )
  const usedSeats = activeMembers.length + livePendingInvites.length

  if (usedSeats >= FREE_TEAM_SEAT_LIMIT) {
    return 'O plano Grátis permite você + 1 membro. Faça upgrade para o Pro para adicionar mais.'
  }
  return null
}
