import type { FixedCost } from '@/domain/types/fixed-cost'

export type FixedCostState = FixedCost & { readonly _version: number }

export const INITIAL_FIXED_COST_STATE: FixedCostState = {
  id: '',
  orgId: '',
  unitId: '',
  seriesId: '',
  name: '',
  category: 'expense_admin',
  amountCents: 0,
  effectiveFrom: '',
  effectiveTo: null,
  archivedAt: null,
  createdAt: '',
  updatedAt: '',
  _version: 0,
}
