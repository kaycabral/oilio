import { getEventStorePool } from '@/shared/db/pg/pool'
import { getPublicOrgNamesByIds } from '@/shared/db/pg/public-org-directory'
import { readAsSubject } from '@/shared/db/pg/rls-read'
import 'server-only'

export async function linkCustomerOrg(userId: string, orgId: string): Promise<void> {
  if (!userId || !orgId) return
  const pool = getEventStorePool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT set_config($1, $2, true)', ['app.current_user_id', userId])
    await client.query(
      `INSERT INTO org_links (user_id, org_id, linked_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, org_id) DO NOTHING`,
      [userId, orgId, new Date().toISOString()],
    )
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function listLinkedOrgIds(userId: string): Promise<string[]> {
  if (!userId) return []
  const rows = await readAsSubject<{ org_id: string }>(userId, (client) =>
    client
      .query<{ org_id: string }>('SELECT org_id FROM org_links WHERE user_id = $1', [userId])
      .then((res) => res.rows),
  )
  return rows.map((r) => r.org_id)
}

export async function isLinkedToOrg(userId: string, orgId: string): Promise<boolean> {
  if (!userId || !orgId) return false
  const rows = await readAsSubject<{ one: number }>(userId, (client) =>
    client
      .query<{
        one: number
      }>('SELECT 1 AS one FROM org_links WHERE user_id = $1 AND org_id = $2 LIMIT 1', [
        userId,
        orgId,
      ])
      .then((res) => res.rows),
  )
  return rows.length > 0
}

export type LinkedEstablishment = {
  orgId: string
  name: string
}

export async function listMyCustomerEstablishments(userId: string): Promise<LinkedEstablishment[]> {
  const orgIds = await listLinkedOrgIds(userId)
  if (orgIds.length === 0) return []
  const nameById = await getPublicOrgNamesByIds(orgIds)
  return orgIds
    .map((orgId) => {
      const name = nameById.get(orgId)
      return { orgId, name: name && name.length > 0 ? name : orgId }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}
