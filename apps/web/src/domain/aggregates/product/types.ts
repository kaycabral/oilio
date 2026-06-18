import type { Product } from '@/domain/types/product'

export type ProductState = Product & { readonly _version: number }

export const INITIAL_PRODUCT_STATE: ProductState = {
  id: '',
  orgId: '',
  name: '',
  sku: null,
  priceCents: 0,
  stock: 0,
  active: false,
  createdAt: '',
  updatedAt: '',
  _version: 0,
}
