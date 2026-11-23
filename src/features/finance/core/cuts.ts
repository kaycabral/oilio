import type { LedgerEntry } from '@/domain'

function signed(entry: LedgerEntry): number {
  const cents: number = entry.amountCents
  return entry.direction === 'in' ? cents : -cents
}

export type PartialContributionMargin = {
  revenueCents: number
  variableCostCents: number
  marginCents: number
  partial: boolean
}

const KNOWN_VARIABLE_NATURES = new Set<LedgerEntry['nature']>(['csp', 'cmv', 'tax_on_sale'])

export function partialContributionMargin(
  ledger: readonly LedgerEntry[],
): PartialContributionMargin {
  let revenueCents = 0
  let variableCostCents = 0
  let hasNonCommissionVariable = false

  for (const entry of ledger) {
    if (entry.nature === 'revenue') {
      revenueCents += signed(entry)
      continue
    }
    if (entry.behavior === 'variable' && KNOWN_VARIABLE_NATURES.has(entry.nature)) {
      const cents: number = entry.amountCents
      variableCostCents += cents
      if (entry.nature !== 'csp') hasNonCommissionVariable = true
    }
  }

  return {
    revenueCents,
    variableCostCents,
    marginCents: revenueCents - variableCostCents,
    partial: !hasNonCommissionVariable,
  }
}

export function fixedCostCents(ledger: readonly LedgerEntry[]): number {
  let total = 0
  for (const entry of ledger) {
    if (entry.behavior === 'fixed' && entry.direction === 'out') {
      const cents: number = entry.amountCents
      total += cents
    }
  }
  return total
}

export type BreakEven =
  | {
      readonly computable: true
      readonly breakEvenRevenueCents: number
      readonly fixedCostCents: number
      readonly marginRatio: number
    }
  | {
      readonly computable: false
      readonly fixedCostCents: number
      readonly reason: 'no_margin'
    }

export function breakEven(ledger: readonly LedgerEntry[]): BreakEven {
  const mc = partialContributionMargin(ledger)
  const fixed = fixedCostCents(ledger)

  if (mc.revenueCents <= 0 || mc.marginCents <= 0) {
    return { computable: false, fixedCostCents: fixed, reason: 'no_margin' }
  }

  const marginRatio = mc.marginCents / mc.revenueCents
  return {
    computable: true,
    breakEvenRevenueCents: Math.round(fixed / marginRatio),
    fixedCostCents: fixed,
    marginRatio,
  }
}
