import { runMigrations } from '@/product'
import { runEventStoreMigrations } from '@/shared/db/pg'

/**
 * Apply every pending migration — the event store (`drizzle/`) and the product
 * base (`drizzle/product`, own journal table) — to `ownerUrl`, as the
 * schema owner, each on a dedicated pool closed afterwards. Both reuse
 * `@cbrl/pg`, so a Supabase host is verified against the pinned root CA. Drizzle
 * applies each journal's pending files in a single transaction under an
 * advisory lock: nothing is ever left half-applied.
 */
export async function applyMigrations(ownerUrl: string): Promise<void> {
  await runEventStoreMigrations(ownerUrl)
  await runMigrations(ownerUrl)
}
