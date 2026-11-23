import type { OpenOrder, Order } from '@/domain/types/order'

export type { OrderStatus } from '@/domain/types/order'

export type OrderState = Order & { readonly _version: number }

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
