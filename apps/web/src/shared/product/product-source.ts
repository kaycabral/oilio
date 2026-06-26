import type { ProductSource } from '@cbrl/product'
import { PostgresProductSource } from '@cbrl/product'
import 'server-only'

// Lazily-built singleton source shared by every read of the sovereign base — the
// registration gate (product-gate) and the live form preview (product-lookup).
// Constructing it opens nothing (the A1 pool is lazy); the first query connects.
// Reused across requests in the server runtime. A single instance keeps the two
// base-reading paths on the SAME connection pool (brief 0054: one source of
// truth — preview and save-gate must not diverge).
let source: ProductSource | undefined

export function getProductSource(): ProductSource {
  source ??= new PostgresProductSource()
  return source
}
