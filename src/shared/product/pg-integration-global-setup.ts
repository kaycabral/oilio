import { requireEnv } from '@cbrl/env'
import { closeDb, runMigrations } from '@/product'
import { closeEventStoreDb, runEventStoreMigrations } from '@/shared/db/pg'
import {
  enableRuntimeRoleLogin,
  OWNER_DATABASE_URL_ENV,
  PRODUCT_OWNER_DATABASE_URL_ENV,
} from '@/shared/db/pg/test/owner-pool'

const REQUIRED = [
  'DATABASE_URL',
  'OILIO_DATABASE_URL',
  PRODUCT_OWNER_DATABASE_URL_ENV,
  OWNER_DATABASE_URL_ENV,
] as const

export default async function globalSetup(): Promise<void> {
  const missing = REQUIRED.filter((name) => !process.env[name]?.trim())
  if (missing.length > 0) {
    throw new Error(
      `test:integration:pg needs ${missing.join(' and ')}: this suite talks to the ` +
        'real `produtos` + `oilio` Postgres databases, as the owner for migrations and ' +
        'as the oilio_app runtime role for the code under test, and is not meant to run ' +
        'bare. Run it through `pnpm test:integration` or `pnpm test:integration:events`, ' +
        'which boot the ephemeral Postgres and inject every connection string.',
    )
  }
  const ownerUrl = requireEnv(OWNER_DATABASE_URL_ENV)

  await runMigrations(requireEnv(PRODUCT_OWNER_DATABASE_URL_ENV))
  await runEventStoreMigrations(ownerUrl)
  await closeDb()
  await closeEventStoreDb()
  await enableRuntimeRoleLogin(ownerUrl, requireEnv('OILIO_DATABASE_URL'))
}
