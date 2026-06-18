import { Schema } from 'effect'

import { InviteStatus, Role } from './enums'

const InviteFields = Schema.mutable(
  Schema.Struct({
    id: Schema.String,
    orgId: Schema.String,
    email: Schema.String,
    role: Role,
    tokenHash: Schema.String,
    expiresAt: Schema.String,
    status: InviteStatus,
    invitedBy: Schema.String,
    // Preenchidos SSE accepted; ausentes em pending (ver refinamento abaixo).
    acceptedByUid: Schema.NullOr(Schema.String),
    acceptedAt: Schema.NullOr(Schema.String),
    createdAt: Schema.String,
    updatedAt: Schema.String,
  }),
)

// `acceptedByUid`/`acceptedAt` presentes SSE accepted, ausentes em pending —
// fecha "accepted sem quem/quando" e "pending com aceite vazado". Refinamento no
// decode (expired/revoked ficam tolerantes a dado herdado de um aceite prévio).
function inviteAcceptanceConsistent(inv: {
  status: InviteStatus
  acceptedByUid: string | null
  acceptedAt: string | null
}): boolean {
  if (inv.status === 'accepted') return inv.acceptedByUid !== null && inv.acceptedAt !== null
  if (inv.status === 'pending') return inv.acceptedByUid === null && inv.acceptedAt === null
  return true
}
const inviteAcceptanceFilter = {
  message: () => 'acceptedByUid/acceptedAt: presentes sse accepted, ausentes em pending',
}

export const Invite = InviteFields.pipe(
  Schema.filter(inviteAcceptanceConsistent, inviteAcceptanceFilter),
)
export type Invite = typeof Invite.Type

// Base sem PII (email) para os EVENTOS: `Schema.partial` não atravessa um
// refinement, então os eventos usam esta forma não-filtrada.
export const StoredInviteFields = InviteFields.pipe(Schema.omit('email'))

// Storage projection of `Invite`: the per-org `invites/{id}` doc that OMITS
// the PII (email), which lives in the deletable `invites_pii/{id}` doc and is
// merged at read time. Decode raw `invites` docs against this (com refinamento).
export const StoredInvite = StoredInviteFields.pipe(
  Schema.filter(inviteAcceptanceConsistent, inviteAcceptanceFilter),
)
export type StoredInvite = typeof StoredInvite.Type

// The complement of `StoredInvite`: the deletable `invites_pii/{id}` doc.
// Picked from the same base so storage and PII sidecar can't drift.
export const InvitePii = InviteFields.pipe(Schema.pick('email'))
export type InvitePii = typeof InvitePii.Type

export const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7

// Strict invite email comparison (#827): the OAuth identity email must
// match the invite email exactly after trim + lowercase. We deliberately do
// not strip dots/`+tag` suffixes — those are real distinct addresses at the
// provider level and an "Alice's Gmail" and "Alice+work's Gmail" can sit in
// different inboxes. False negatives are fine ("ask for a new invite");
// false positives are not.
export function normalizeInviteEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function inviteEmailsMatch(sessionEmail: string, inviteEmail: string): boolean {
  return normalizeInviteEmail(sessionEmail) === normalizeInviteEmail(inviteEmail)
}
