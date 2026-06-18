import type { Service } from '@/domain/types/service'

export type ServiceState = Service & { readonly _version: number }

export const INITIAL_SERVICE_STATE: ServiceState = {
  id: '',
  orgId: '',
  name: '',
  category: null,
  durationMinutes: 0,
  priceCents: 0,
  commission: null,
  requiredResources: [],
  active: false,
  publicVisible: false,
  priceVisibility: 'visible',
  unitIds: [],
  unitOverrides: null,
  createdAt: '',
  updatedAt: '',
  _version: 0,
}
