import { defaultPermissionsForRole, type Membership } from '@/domain/types/membership'

export type MembershipState = Membership & { readonly _version: number }

export const INITIAL_MEMBERSHIP_STATE: MembershipState = {
  id: '',
  orgId: '',
  userId: '',
  role: 'receptionist',
  status: 'active',
  invitedBy: null,
  joinedAt: '',
  updatedAt: '',
  rlsUnitScope: null,
  permissions: defaultPermissionsForRole('receptionist'),
  _version: 0,
}
