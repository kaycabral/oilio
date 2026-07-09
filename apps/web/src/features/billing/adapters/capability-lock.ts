import { type Capability, hasCapability } from '@/domain/billing/capabilities'
import { getOrgTier } from '@/shared/org/billing-read'
import 'server-only'

export async function isCapabilityLocked(orgId: string, capability: Capability): Promise<boolean> {
  const tier = await getOrgTier(orgId)
  return !hasCapability(tier, capability)
}
