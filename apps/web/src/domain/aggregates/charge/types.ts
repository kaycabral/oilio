import type { Charge } from '@/domain/types/charge'

export type { ChargeStatus } from '@/domain/types/charge'

export type ChargeState = Charge & { readonly _version: number }

export const INITIAL_CHARGE_STATE: ChargeState = {
  id: '',
  orgId: '',
  unitId: '',
  subscriptionId: '',
  customerId: '',
  amountCents: 0,
  periodStartAt: '',
  periodEndAt: '',
  dueDate: '',
  status: 'scheduled',
  attempts: 0,
  paidAt: null,
  failedAt: null,
  failureReason: null,
  refundedAt: null,
  lastActorUid: null,
  createdAt: '',
  updatedAt: '',
  _version: 0,
}
