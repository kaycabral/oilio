import type { StoredCustomer } from '@/domain/types/customer'

// Projeção event-sourced = o doc operacional `StoredCustomer` (PII omitida —
// materializada na leitura via customer-read) + a versão do stream.
export type CustomerState = StoredCustomer & { readonly _version: number }

export const INITIAL_CUSTOMER_STATE: CustomerState = {
  id: '',
  orgId: '',
  userId: '',
  archivedAt: null,
  deactivatedAt: null,
  createdAt: '',
  updatedAt: '',
  _version: 0,
}
