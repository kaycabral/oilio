import type { Commission } from '@/domain/types/commission'

export type CommissionState = Commission & { readonly _version: number }

export const INITIAL_COMMISSION_STATE: CommissionState = {
  id: '',
  orgId: '',
  orderId: '',
  orderItemId: '',
  attributedUserId: '',
  attributedMemberName: '',
  itemKind: 'service',
  itemName: '',
  itemTotalCents: 0,
  commissionKind: 'percentage',
  commissionValue: 0,
  amountCents: 0,
  liquidationStatus: 'pendente',
  paidAt: null,
  paymentProof: null,
  createdAt: '',
  _version: 0,
}
