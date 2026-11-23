import type { ProductSource } from '@/product'
import { PostgresProductSource } from '@/product'
import 'server-only'

let source: ProductSource | undefined

export function getProductSource(): ProductSource {
  source ??= new PostgresProductSource()
  return source
}
