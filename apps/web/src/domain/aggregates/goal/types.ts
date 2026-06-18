import type { Goal } from '@/domain/types/goal'

export type GoalState = Goal & { readonly _version: number }

// Initial state — every field is overwritten by the `defined` snapshot on
// replay (event-first: replay reconstructs the full doc from the stream).
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
