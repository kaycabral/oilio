import { closeEventStoreDb, runEventStoreMigrations } from '@/shared/db/pg'
import { closeDb, runMigrations } from '@cbrl/product'

export default async function globalSetup(): Promise<void> {
  const missing = (['DATABASE_URL', 'OILIO_DATABASE_URL'] as const).filter(
    (name) => !process.env[name]?.trim(),
  )
  if (missing.length > 0) {
    throw new Error(
      `test:integration:pg needs ${missing.join(' and ')}: this suite talks to the ` +
        'real `produtos` + `oilio` Postgres databases and is not meant to run bare. ' +
        'Run it through the runner — `node scripts/product-it.mjs` (or `pnpm --filter ' +
        '@oilio/web test:integration` for the whole PG layer) — which boots the ephemeral ' +
        'Postgres and injects both connection strings. In CI the `integration:product` ' +
        'job supplies them via `services: postgres`.',
    )
  }

  await runMigrations()
  await runEventStoreMigrations()
  await closeDb()
  await closeEventStoreDb()
}
