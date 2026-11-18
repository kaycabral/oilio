import type { ProductSource } from '@oilio/product'
import { PostgresProductSource } from '@oilio/product'
import 'server-only'

let source: ProductSource | undefined

export function getProductSource(): ProductSource {
  source ??= new PostgresProductSource()
  return source
}
