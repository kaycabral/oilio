import type { StoredCustomer } from '@/domain/types/customer'

export type CustomerState = StoredCustomer & { readonly _version: number }

export const INITIAL_CUSTOMER_STATE: CustomerState = {
  id: '',
  orgId: '',
  userId: '',
  archivedAt: null,
  deactivatedAt: null,
  acquisition: null,
  createdAt: '',
  updatedAt: '',
  _version: 0,
}
