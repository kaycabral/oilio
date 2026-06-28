import type { StoredInvite } from '@/domain/types/invite'

// Projeção event-sourced = o doc operacional `StoredInvite` (PII email omitida —
// materializada na leitura via invite-read) + a versão do stream.
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
