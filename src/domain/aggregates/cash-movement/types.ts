import type { CashMovement } from '@/domain/types/cash-movement'

export type CashMovementState = CashMovement & { readonly _version: number }

export const INITIAL_CASH_MOVEMENT_STATE: CashMovementState = {
  id: '',
  orgId: '',
  unitId: '',
  kind: 'sangria',
  direction: 'out',
  amountCents: 0,
  paymentMethod: null,
  description: null,
  orderId: null,
  expenseCategoryId: null,
  recordedByUid: '',
  createdAt: '',
  _version: 0,
}
