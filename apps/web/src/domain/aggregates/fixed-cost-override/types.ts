import type { FixedCostOverride } from '@/domain/types/fixed-cost'

export type FixedCostOverrideState = FixedCostOverride & { readonly _version: number }

export const INITIAL_FIXED_COST_OVERRIDE_STATE: FixedCostOverrideState = {
  id: '',
  orgId: '',
  unitId: '',
  seriesId: '',
  month: '',
  amountCents: 0,
  createdAt: '',
  updatedAt: '',
  _version: 0,
}
