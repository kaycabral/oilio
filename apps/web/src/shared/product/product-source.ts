import type { ProductSource } from '@cbrl/product'
import { PostgresProductSource } from '@cbrl/product'
import 'server-only'

let source: ProductSource | undefined

export function getProductSource(): ProductSource {
  source ??= new PostgresProductSource()
  return source
}
