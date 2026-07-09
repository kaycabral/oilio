import type { FixedCost, FixedCostOverride } from '@/domain'
import { enumerateCompetenceMonths, overlapsWindow } from '@/domain/utils/competence-month'
import type { FixedCostFact } from '@/domain/utils/ledger'

export type FixedCostExpansionInput = {
  readonly fromIso: string
  readonly toIso: string
  readonly costs: readonly FixedCost[]
  readonly overrides: readonly FixedCostOverride[]
  readonly timezoneForUnit: (unitId: string) => string
}

export function expandFixedCosts(input: FixedCostExpansionInput): FixedCostFact[] {
  const overrideByKey = indexOverrides(input.overrides)
  const facts: FixedCostFact[] = []

  for (const cost of input.costs) {
    const tz = input.timezoneForUnit(cost.unitId)
    const months = enumerateCompetenceMonths(input.fromIso, input.toIso, tz)
    for (const { month, startUtc } of months) {
      if (!overlapsWindow(cost.effectiveFrom, cost.effectiveTo, month, tz)) continue
      const override = overrideByKey.get(overrideKey(cost.seriesId, month))
      const amountCents = override ? override.amountCents : cost.amountCents
      if (amountCents <= 0) continue
      facts.push({
        orgId: cost.orgId,
        unitId: cost.unitId,
        seriesId: cost.seriesId,
        nature: cost.category,
        amountCents,
        month,
        occurredAt: startUtc,
      })
    }
  }
  return facts
}

function indexOverrides(overrides: readonly FixedCostOverride[]): Map<string, FixedCostOverride> {
  const map = new Map<string, FixedCostOverride>()
  for (const o of overrides) map.set(overrideKey(o.seriesId, o.month), o)
  return map
}

function overrideKey(seriesId: string, month: string): string {
  return `${seriesId}:${month}`
}
