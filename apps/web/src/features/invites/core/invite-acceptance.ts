// Functional core for the accept-invite flow: the pure eligibility decision the
// page (to choose what to render) and the action (to authorize) both rely on.
// Token verification stays in the adapter — it needs node:crypto (server-only).
// This decides everything else from plain data: status, expiry, and the strict
// email match (#827).

import { type Invite, inviteEmailsMatch } from '@/domain'

export type InviteEligibility =
  | { ok: true }
  | { ok: false; reason: 'not_pending' | 'expired' | 'email_mismatch' }

// Decides whether `sessionEmail` may accept `invite` at `now`. Pure: no token
// check (that's I/O), no membership creation (that's the saga).
export function checkInviteEligibility(
  invite: Pick<Invite, 'status' | 'expiresAt' | 'email'>,
  sessionEmail: string | null,
  now: Date = new Date(),
): InviteEligibility {
  if (invite.status !== 'pending') return { ok: false, reason: 'not_pending' }
  if (new Date(invite.expiresAt).getTime() < now.getTime()) {
    return { ok: false, reason: 'expired' }
  }
  if (!sessionEmail || !inviteEmailsMatch(sessionEmail, invite.email)) {
    return { ok: false, reason: 'email_mismatch' }
  }
  return { ok: true }
}
