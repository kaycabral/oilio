import { hasCapability } from '@/domain/billing/capabilities'
import { getOrgTier } from '@/shared/org/billing-read'
import { listInvitesByStatus } from '@/shared/org/invite-read'
import { listActiveOrgMemberships } from '@/shared/org/membership'

export const FREE_TEAM_SEAT_LIMIT = 2

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
