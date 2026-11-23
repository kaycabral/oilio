import { getEventStorePool } from '@/shared/db/pg/pool'

export async function withUserOnboardingLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const client = await getEventStorePool().connect()
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [userId])
    return await fn()
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', [userId])
    client.release()
  }
}
