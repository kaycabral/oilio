import type { PoolClient, QueryResultRow } from 'pg'
import { setRlsGucs, setSubjectGuc } from './guc'
import { getEventStorePool } from './pool'

function toReleaseError(failed: unknown): Error | undefined {
  if (failed === undefined) return undefined
  return failed instanceof Error ? failed : new Error('non-Error thrown from RLS read callback')
}

export async function readUnderRls<T extends QueryResultRow>(
  orgId: string,
  fn: (client: PoolClient) => Promise<T[]>,
  unitId = '',
  memberOperationId = '',
): Promise<T[]> {
  const client = await getEventStorePool().connect()
  let failed: unknown
  try {
    await client.query('BEGIN')
    await setRlsGucs(client, orgId, unitId, memberOperationId)
    const rows = await fn(client)
    await client.query('COMMIT')
    return rows
  } catch (err) {
    failed = err
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release(toReleaseError(failed))
  }
}

export async function readAsSubject<T extends QueryResultRow>(
  userId: string,
  fn: (client: PoolClient) => Promise<T[]>,
): Promise<T[]> {
  const client = await getEventStorePool().connect()
  let failed: unknown
  try {
    await client.query('BEGIN')
    await setSubjectGuc(client, userId)
    const rows = await fn(client)
    await client.query('COMMIT')
    return rows
  } catch (err) {
    failed = err
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release(toReleaseError(failed))
  }
}
