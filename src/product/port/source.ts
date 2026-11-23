import type { NewProduct, StoredProduct } from '../schema'

export interface ProductSource {
  findByGtin14(gtin14: string): Promise<StoredProduct | null>

  upsert(input: NewProduct): Promise<StoredProduct>

  searchByName(query: string, limit: number): Promise<StoredProduct[]>
}
