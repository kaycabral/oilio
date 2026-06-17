import { defaultPermissionsForRole, type Membership } from '@/domain/types/membership'

// AC-05 (brief 0025): projeção cobre o doc operacional inteiro (status, invitedBy,
// joinedAt, unitId, permissions, commissionRate, timestamps), derivada só de
// eventos. `MembershipState` == `Membership` + `_version`.
export type MembershipState = Membership & { readonly _version: number }

export const INITIAL_MEMBERSHIP_STATE: MembershipState = {
  id: '',
  tenantId: '',
  userId: '',
  role: 'customer',
  status: 'active',
  invitedBy: null,
  joinedAt: '',
  updatedAt: '',
  unitId: null,
  permissions: defaultPermissionsForRole('customer'),
  commissionRate: null,
  _version: 0,
}
