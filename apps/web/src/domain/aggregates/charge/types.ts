import type { Charge } from '@/domain/types/charge'

export type { ChargeStatus } from '@/domain/types/charge'

// AC-05 (brief 0025): a projeção cobre o doc operacional inteiro da cobrança
// (período, vencimento, tentativas, datas de liquidação/falha),
// derivada só de eventos. `ChargeState` == `Charge` + `_version`.
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
