import { Schema } from 'effect'

import { type Tier } from './tiers'

// A Capability is a gated unit of access unlocked by a Plano Oilio tier.
// Data-driven: moving a capability between tiers is a one-line edit to
// TIER_CAPABILITIES. Canonical model: PRD-Monetizacao-SaaS; Linguagem § Capability.
//
// Derived directly from the active /pricing bullets (Pro "Tudo do Free, e mais…";
// Avançado "Tudo do Pro, e mais…") so packaging and enforcement never drift.
//
// NOTE (brief 0070 AC-04): only features NAVIGABLE TODAY are capabilities. The
// "Em breve" items of the Avançado tier (automatic recurring charge, payment
// split, cash/gateway reconciliation, multi-unit reports) are NOT here — they
// are roadmap, not gated capabilities.
export const CAPABILITIES = [
  // "Planos e assinaturas (recorrência)"
  'plans.recurring',
  // "Comissão por profissional e liquidação"
  'commissions',
  // "Copiloto: meta mensal de lucro"
  'copilot.profit_goal',
  // "Relatórios de vendas e comissões"
  'reports.sales',
  // Free = 1 unidade; pro+ = ilimitado (cobrado por unidade)
  'units.unlimited',
  // "Suporte prioritário" (Avançado)
  'support.priority',
] as const
export const Capability = Schema.Literal(...CAPABILITIES)
export type Capability = typeof Capability.Type

// Pro's capability set, reused by Avançado (which is a strict superset).
const PRO_CAPABILITIES: readonly Capability[] = [
  'plans.recurring',
  'commissions',
  'copilot.profit_goal',
  'reports.sales',
  'units.unlimited',
]

// tier → capabilities. Free baseline (agenda, comanda, caixa, cadastros,
// self-booking) needs no capability — it is ungated. Avançado = Pro ∪ priority.
export const TIER_CAPABILITIES: Record<Tier, ReadonlySet<Capability>> = {
  free: new Set<Capability>(),
  pro: new Set<Capability>(PRO_CAPABILITIES),
  advanced: new Set<Capability>([...PRO_CAPABILITIES, 'support.priority']),
}

export function hasCapability(tier: Tier, capability: Capability): boolean {
  return TIER_CAPABILITIES[tier].has(capability)
}
