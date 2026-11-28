import { Schema } from 'effect'

import { type Tier } from './tiers'

export const CAPABILITIES = [
  'plans.recurring',
  'commissions',
  'copilot.profit_goal',
  'reports.sales',
  'units.unlimited',
  'team.unlimited',
  'support.priority',
] as const
export const Capability = Schema.Literals(CAPABILITIES)
export type Capability = typeof Capability.Type

const PRO_CAPABILITIES: readonly Capability[] = [
  'plans.recurring',
  'commissions',
  'copilot.profit_goal',
  'reports.sales',
  'units.unlimited',
  'team.unlimited',
]

export const TIER_CAPABILITIES: Record<Tier, ReadonlySet<Capability>> = {
  free: new Set<Capability>(),
  pro: new Set<Capability>(PRO_CAPABILITIES),
  advanced: new Set<Capability>([...PRO_CAPABILITIES, 'support.priority']),
}

export function hasCapability(tier: Tier, capability: Capability): boolean {
  return TIER_CAPABILITIES[tier].has(capability)
}
