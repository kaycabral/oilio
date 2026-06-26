import { defaultPermissionsForRole, type Membership } from '@/domain/types/membership'

// AC-05 (brief 0025): projeção cobre o doc operacional inteiro (status, invitedBy,
// joinedAt, rlsUnitScope, permissions, timestamps), derivada só de eventos.
// `MembershipState` == `Membership` + `_version`.
export type MembershipState = Membership & { readonly _version: number }

export const INITIAL_MEMBERSHIP_STATE: MembershipState = {
  id: '',
  orgId: '',
  userId: '',
  role: 'customer',
  status: 'active',
  invitedBy: null,
  joinedAt: '',
  updatedAt: '',
  rlsUnitScope: null,
  permissions: defaultPermissionsForRole('customer'),
  _version: 0,
}
