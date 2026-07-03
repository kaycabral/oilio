import { Schema } from 'effect'

import { InviteStatus, Role } from './enums'

const InviteFields = Schema.mutable(
  Schema.Struct({
    id: Schema.String,
    orgId: Schema.String,
    mobile: Schema.String,
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

// Base sem PII (mobile) para os EVENTOS: `Schema.partial` não atravessa um
// refinement, então os eventos usam esta forma não-filtrada.
export const StoredInviteFields = InviteFields.pipe(Schema.omit('mobile'))

// Storage projection of `Invite`: the per-org `invites/{id}` doc that OMITS
// the PII (mobile), which lives in the deletable `invites_pii/{id}` doc and is
// merged at read time. Decode raw `invites` docs against this (com refinamento).
export const StoredInvite = StoredInviteFields.pipe(
  Schema.filter(inviteAcceptanceConsistent, inviteAcceptanceFilter),
)
export type StoredInvite = typeof StoredInvite.Type

// The complement of `StoredInvite`: the deletable `invites_pii/{id}` doc.
// Picked from the same base so storage and PII sidecar can't drift.
export const InvitePii = InviteFields.pipe(Schema.pick('mobile'))
export type InvitePii = typeof InvitePii.Type

// 48h (brief 0084): the signed token is the invite's primary access lock, so a
// short window is direct defense against a forwarded/leaked link. Was 7d when
// the strict email match (#827) also bound the invite to one identity; with the
// match gone (first-accept-wins), the tighter expiry carries that weight.
export const INVITE_TTL_MS = 1000 * 60 * 60 * 48
