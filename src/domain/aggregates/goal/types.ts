import type { Goal } from '@/domain/types/goal'

export type GoalState = Goal & { readonly _version: number }

export const INITIAL_GOAL_STATE: GoalState = {
  id: '',
  orgId: '',
  unitId: '',
  period: '',
  type: 'profit',
  targetCents: 0,
  createdAt: '',
  updatedAt: '',
  _version: 0,
}
