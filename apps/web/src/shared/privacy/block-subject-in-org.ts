import { CustomerConfig } from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { emitEvent } from '@/shared/effect-bridge'
import { eraseCustomerCascadeInOrg } from '@/shared/privacy/erase-customer-cascade'
import 'server-only'

// global `users/{uid}` doc is untouched; only this org's view of the

export type BlockSubjectResult = {
  blocked: boolean
  archivedCustomers: number
  hadActiveSubscription: boolean
}

export async function blockSubjectInOrg(
  orgId: string,
  userId: string,
): Promise<BlockSubjectResult> {
  if (!userId) return { blocked: false, archivedCustomers: 0, hadActiveSubscription: false }

  const cascade = await eraseCustomerCascadeInOrg(orgId, userId)

  const archivedCustomers = await archiveCustomerShadows(orgId, userId)

  return {
    blocked: true,
    archivedCustomers,
    hadActiveSubscription: cascade.hadActiveSubscription,
  }
}

async function archiveCustomerShadows(orgId: string, userId: string): Promise<number> {
  const customerIds = await readUnderRls<{ id: string }>(orgId, (client) =>
    client
      .query<{
        id: string
      }>('SELECT id FROM customers WHERE org_id = $1 AND user_id = $2', [orgId, userId])
      .then((res) => res.rows),
  )

  let archived = 0
  for (const { id } of customerIds) {
    const now = new Date().toISOString()
    const res = await emitEvent(CustomerConfig, aggregateRef(CustomerConfig, orgId, id), {
      _tag: 'customer.updated',
      actorId: userId,
      payload: { changes: { archivedAt: now } },
    })
    if (!res.ok) throw new Error(`Failed to archive customer ${id}: ${res.error}`)
    archived += 1
  }
  return archived
}
