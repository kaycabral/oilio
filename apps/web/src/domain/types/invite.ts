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
    acceptedByUid: Schema.NullOr(Schema.String),
    acceptedAt: Schema.NullOr(Schema.String),
    createdAt: Schema.String,
    updatedAt: Schema.String,
  }),
)

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

export const StoredInviteFields = InviteFields.pipe(Schema.omit('mobile'))

export const StoredInvite = StoredInviteFields.pipe(
  Schema.filter(inviteAcceptanceConsistent, inviteAcceptanceFilter),
)
export type StoredInvite = typeof StoredInvite.Type

export const InvitePii = InviteFields.pipe(Schema.pick('mobile'))
export type InvitePii = typeof InvitePii.Type

export const INVITE_TTL_MS = 1000 * 60 * 60 * 48
