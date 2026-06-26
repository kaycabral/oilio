import type { Commission } from '@/domain/types/commission'

// AC-05 (brief 0025): a projeção cobre o doc operacional inteiro da comissão
// (snapshot do item, regra aplicada, liquidação do split, repasse manual),
// derivada só de eventos. `CommissionState` == `Commission` + `_version`.
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
