import { type Capability, hasCapability } from '@/domain/billing/capabilities'
import { getOrgTier } from '@/shared/org/billing-read'
import 'server-only'

/**
 * Server-side companion to the client `useCapability` (brief 0082): does the
 * given Negócio's tier LACK `capability`? Loaders/pages use it to render the
 * upgrade CTA in place of a gated surface — the same decision `useCapability`
 * makes on the client, resolved on the server where the tier is already known.
 *
 * NOT the security boundary: the matching `requireCapability` guard in the
 * server action is the real wall (brief 0072). This only shapes what the page
 * renders, so a Free org never reaches a form that would only fail on submit.
 */
export async function isCapabilityLocked(orgId: string, capability: Capability): Promise<boolean> {
  const tier = await getOrgTier(orgId)
  return !hasCapability(tier, capability)
}
