import type { CatalogItem } from '@/domain/types/catalog-item'

export type CatalogItemState = CatalogItem & { readonly _version: number }

// Initial state defaults to a `service` shape (the discriminant + every
// kind-specific field is overwritten by the `created` snapshot on replay).
// Product-only fields (`sku`, `stock`) are absent here and arrive via the
// `created` event — replay reconstructs the full doc from the stream.
export const INITIAL_CATALOG_ITEM_STATE: CatalogItemState = {
  id: '',
  tenantId: '',
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
