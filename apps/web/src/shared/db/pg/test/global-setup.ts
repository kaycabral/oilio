import { closeEventStoreDb, runEventStoreMigrations } from '../index'

/**
 * Vitest globalSetup for the event-store integration suite (brief 0057).
 *
 * Brings the connected `oilio` database (OILIO_DATABASE_URL — ephemeral Postgres
 * in docker locally, `services: postgres` in CI) up to the current schema by
 * applying the versioned migrations, then closes the pool so the test workers
 * open their own. Mirrors the `@cbrl/product` integration globalSetup.
 */
export default async function globalSetup(): Promise<void> {
  await runEventStoreMigrations()
  await closeEventStoreDb()
}
