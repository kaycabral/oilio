import { desc, eq, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { ProductSource } from '../port/source'
import type * as schema from '../schema'
import { product, type NewProduct, type StoredProduct } from '../schema'
import { getDb } from './pool'

type ProductDb = NodePgDatabase<typeof schema>

export const NAME_SEARCH_SIMILARITY_THRESHOLD = 0.2

export class PostgresProductSource implements ProductSource {
  constructor(private readonly db: ProductDb = getDb()) {}

  async findByGtin14(gtin14: string): Promise<StoredProduct | null> {
    const rows = await this.db.select().from(product).where(eq(product.gtin14, gtin14)).limit(1)
    return rows[0] ?? null
  }

  async upsert(input: NewProduct): Promise<StoredProduct> {
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
    const stored = rows[0]
    if (stored === undefined) throw new Error('upsert returned no row')
    return stored
  }

  async searchByName(query: string, limit: number): Promise<StoredProduct[]> {
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
