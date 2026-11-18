import { closeEventStoreDb, runEventStoreMigrations } from '@/shared/db/pg'
import { closeDb, runMigrations } from '@oilio/product'

/**
 * Apply every pending migration — the event store (`drizzle/`) and the product
 * base (`packages/product/drizzle`, own journal table) — to `ownerUrl`, as the
 * schema owner. Both pools reuse `@cbrl/pg`, so a Supabase host is verified
 * against the pinned root CA. Drizzle applies each journal's pending files in a
 * single transaction under an advisory lock: nothing is ever left half-applied.
 */
export async function applyMigrations(ownerUrl: string): Promise<void> {
  process.env.OILIO_DATABASE_URL = ownerUrl
  process.env.DATABASE_URL = ownerUrl
  try {
    await runEventStoreMigrations()
    await runMigrations()
  } finally {
    await Promise.all([closeEventStoreDb(), closeDb()])
  }
}
