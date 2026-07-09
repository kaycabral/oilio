import { readUnderRls } from '@/shared/db/pg/rls-read'
import { getCustomerUserId } from '@/shared/org/customer-read'
import { AuthzError } from '@/shared/org/membership'
import 'server-only'

export async function assertCustomerNotBlocked(orgId: string, userId: string): Promise<void> {
  if (!userId) return
  const rows = await readUnderRls<{ one: number }>(orgId, (client) =>
    client
      .query<{ one: number }>(
        `SELECT 1 AS one FROM customers
           WHERE org_id = $1 AND user_id = $2 AND archived_at IS NOT NULL LIMIT 1`,
        [orgId, userId],
      )
      .then((res) => res.rows),
  )
  if (rows.length > 0) {
    throw new AuthzError(
      `Customer ${userId} is blocked in org ${orgId} — write rejected (LGPD art. 18 block, brief 0032 AC-11)`,
    )
  }
}

export async function assertCustomerIdNotBlocked(orgId: string, customerId: string): Promise<void> {
  const userId = await getCustomerUserId(orgId, customerId)
  if (!userId) return
  await assertCustomerNotBlocked(orgId, userId)
}
