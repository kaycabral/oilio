import type { OpenOrder, Order } from '@/domain/types/order'

export type { OrderStatus } from '@/domain/types/order'

// AC-05 (brief 0025): a projeção cobre o doc operacional inteiro da comanda —
// incluindo `items[]`, desconto, observação, totais e timestamps —, derivada só
// de eventos. `OrderState` == `Order` + `_version`.
export type OrderState = Order & { readonly _version: number }

// Toda order nasce aberta — tipar o estado inicial como o ramo aberto concreto
// (não a união) preserva a correlação ao espalhá-lo.
export const INITIAL_ORDER_STATE: OpenOrder & { readonly _version: number } = {
  id: '',
  orgId: '',
  unitId: '',
  customerId: '',
  appointmentId: null,
  status: 'open',
  items: [],
  discountCents: 0,
  closedAt: null,
  paymentMethod: null,
  subtotalCents: 0,
  totalCents: 0,
  createdAt: '',
  updatedAt: '',
  _version: 0,
}
