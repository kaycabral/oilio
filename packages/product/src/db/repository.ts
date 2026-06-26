import { desc, eq, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { ProductSource } from '../port/source'
import type * as schema from '../schema'
import { product, type NewProduct, type StoredProduct } from '../schema'
import { getDb } from './pool'

type ProductDb = NodePgDatabase<typeof schema>

/**
 * Minimum trigram similarity a row must clear to surface as a suggestion. Below
 * this, `pg_trgm` returns mostly noise (e.g. a 3-letter query matching dozens of
 * unrelated names by a single shared trigram). Tuned conservative for V0; the
 * brief flags calibration with real usage (short/generic names like "leite").
 */
export const NAME_SEARCH_SIMILARITY_THRESHOLD = 0.2

/**
 * Postgres-backed `ProductSource` adapter. Minimal in A1: insert + get-by-GTIN.
 * The domain lookup and auto-contribution flow are A2 (brief 0050).
 */
export class PostgresProductSource implements ProductSource {
  constructor(private readonly db: ProductDb = getDb()) {}

  async findByGtin14(gtin14: string): Promise<StoredProduct | null> {
    const rows = await this.db.select().from(product).where(eq(product.gtin14, gtin14)).limit(1)
    return rows[0] ?? null
  }

  async upsert(input: NewProduct): Promise<StoredProduct> {
    // Idempotent on the GTIN-14 UNIQUE key: re-contributing the same product
    // updates intrinsic attributes instead of erroring (A2 relies on this).
    const rows = await this.db
      .insert(product)
      .values(input)
      .onConflictDoUpdate({
        target: product.gtin14,
        set: {
          name: input.name,
          description: input.description,
          brand: input.brand,
          photoUrl: input.photoUrl,
          measures: input.measures,
          ncm: input.ncm,
          cest: input.cest,
          utrib: input.utrib,
          category: input.category,
          source: input.source,
          updatedAt: new Date(),
        },
      })
      .returning()
    // `returning()` on a single-row insert always yields exactly one row.
    const stored = rows[0]
    if (stored === undefined) throw new Error('upsert returned no row')
    return stored
  }

  async searchByName(query: string, limit: number): Promise<StoredProduct[]> {
    // Trigram search (`pg_trgm`), ranked by similarity desc, capped at `limit`.
    //
    // The filter is the `%` operator (`name % query`), NOT `similarity() > const`:
    // only `%` (and `<->`) is index-backed by the GIN `gin_trgm_ops` index
    // (migration 0001). A bare `similarity() > const` predicate is non-sargable —
    // Postgres would seq-scan the whole base computing similarity() per row, which
    // defeats the index exactly as the cross-org base grows. `%` lets the GIN index
    // gate the candidate set; `similarity()` then only ranks the survivors.
    //
    // `%` thresholds on the session GUC `pg_trgm.similarity_threshold` (default
    // 0.3), so we set it to our constant via `set_limit()` first. Both run in ONE
    // transaction so the GUC change is scoped to this query (no cross-connection
    // leak from the pooled connection). Parameterized via drizzle `sql` — never
    // string-interpolated — so the term is safe regardless of content.
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_limit(${NAME_SEARCH_SIMILARITY_THRESHOLD})`)
      const similarity = sql<number>`similarity(${product.name}, ${query})`
      return tx
        .select()
        .from(product)
        .where(sql`${product.name} % ${query}`)
        .orderBy(desc(similarity))
        .limit(limit)
    })
  }
}
