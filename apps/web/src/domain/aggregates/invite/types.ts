import type { StoredInvite } from '@/domain/types/invite'

export type InviteState = StoredInvite & { readonly _version: number }

export const INITIAL_INVITE_STATE: InviteState = {
  id: '',
  orgId: '',
  role: 'member_operator',
  tokenHash: '',
  expiresAt: '',
  status: 'pending',
  invitedBy: '',
  acceptedByUid: null,
  acceptedAt: null,
  createdAt: '',
  updatedAt: '',
  _version: 0,
}
