import type { CashMovement } from '@/domain/types/cash-movement'

// AC-05 (brief 0025): a projeção cobre o doc operacional inteiro do movimento
// de caixa (kind, direção, valor, forma de pagamento, vínculos, categoria),
// derivada só de eventos. `CashMovementState` == `CashMovement` + `_version`.
// Caixa sem sessão (brief 0015): movimento standalone, sem `cashRegisterId`.
export type CashMovementState = CashMovement & { readonly _version: number }

// Sentinela pré-criação (sobrescrito pelo evento `created`); usa a variante sem
// vínculos pra ser um membro válido da união sem FK falsa.
export const INITIAL_CASH_MOVEMENT_STATE: CashMovementState = {
  id: '',
  tenantId: '',
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
