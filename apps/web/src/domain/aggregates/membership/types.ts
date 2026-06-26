import { defaultPermissionsForRole, type Membership } from '@/domain/types/membership'

// AC-05 (brief 0025): projeção cobre o doc operacional inteiro (status, invitedBy,
// joinedAt, rlsUnitScope, permissions, timestamps), derivada só de eventos.
// `MembershipState` == `Membership` + `_version`.
export type MembershipState = Membership & { readonly _version: number }

export const INITIAL_MEMBERSHIP_STATE: MembershipState = {
  id: '',
  orgId: '',
  userId: '',
  // Pre-first-event sentinel only: `membership.created` replaces the whole state
  // (reducer does `{...base, ...event.data}`), so this role is never read as a
  // real grant. `receptionist` is the lowest-privilege real role — brief 0068 D4
  // / AC-04 removed the vestigial `customer` role.
  role: 'receptionist',
  status: 'active',
  invitedBy: null,
  joinedAt: '',
  updatedAt: '',
  rlsUnitScope: null,
  permissions: defaultPermissionsForRole('receptionist'),
  _version: 0,
}
