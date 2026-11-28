import { requireEnv } from '@cbrl/env'
import { closeEventStoreDb, runEventStoreMigrations } from '../index'
import { enableRuntimeRoleLogin, OWNER_DATABASE_URL_ENV } from './owner-pool'

export default async function globalSetup(): Promise<void> {
  const ownerUrl = requireEnv(OWNER_DATABASE_URL_ENV)
  await runEventStoreMigrations(ownerUrl)
  await closeEventStoreDb()
  await enableRuntimeRoleLogin(ownerUrl, requireEnv('OILIO_DATABASE_URL'))
}
