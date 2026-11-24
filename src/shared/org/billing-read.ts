import type { Tier } from '@/domain/billing/tiers'
import { StoredOrgBilling } from '@/domain/types/org-billing'
import { type OrgBillingRow, rowToDoc } from '@/shared/db/pg/effect/org-billing-projector'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { Schema } from 'effect'
import 'server-only'

const decodeOrgBilling = Schema.decodeUnknownSync(StoredOrgBilling)

export function freeOrgBilling(orgId: string): StoredOrgBilling {
  return {
    id: orgId,
    orgId,
    tier: 'free',
    status: 'active',
    billingCycle: null,
    unitQuantity: 1,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    createdAt: '',
    updatedAt: '',
  }
}

export async function getOrgBilling(orgId: string): Promise<StoredOrgBilling> {
  const rows = await readUnderRls<OrgBillingRow>(orgId, (client) =>
    client
      .query<OrgBillingRow>('SELECT * FROM org_billing WHERE org_id = $1', [orgId])
      .then((res) => res.rows),
  )
  const row = rows[0]
  return row ? decodeOrgBilling(rowToDoc(row)) : freeOrgBilling(orgId)
}

export async function getOrgTier(orgId: string): Promise<Tier> {
  return (await getOrgBilling(orgId)).tier
}
