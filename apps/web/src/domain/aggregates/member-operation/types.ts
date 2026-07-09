import type { StoredMemberOperation } from '@/domain/types/member-operation'

export type MemberOperationState = StoredMemberOperation & { readonly _version: number }

export const INITIAL_MEMBER_OPERATION_STATE: MemberOperationState = {
  id: '',
  orgId: '',
  userId: '',
  defaultCommission: null,
  unitIds: [],
  catalogServiceIds: [],
  createdAt: '',
  updatedAt: '',
  _version: 0,
}
