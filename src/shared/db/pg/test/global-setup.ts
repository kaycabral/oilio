import { closeEventStoreDb, runEventStoreMigrations } from '../index'

export default async function globalSetup(): Promise<void> {
  await runEventStoreMigrations()
  await closeEventStoreDb()
}
