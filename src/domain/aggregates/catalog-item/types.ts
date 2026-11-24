import type { CatalogItem } from '@/domain/types/catalog-item'

export type CatalogItemState = CatalogItem & { readonly _version: number }

export const INITIAL_CATALOG_ITEM_STATE: CatalogItemState = {
  id: '',
  orgId: '',
  kind: 'service',
  name: '',
  categoryId: null,
  priceCents: 0,
  commission: null,
  unitIds: [],
  unitOverrides: null,
  publicVisible: false,
  priceVisibility: 'visible',
  active: false,
  archivedAt: null,
  durationMinutes: 0,
  requiredResources: [],
  createdAt: '',
  updatedAt: '',
  _version: 0,
}
