import { Schema, Struct } from 'effect'

import { NonEmptyString, NonNegativeInt } from '@/domain/value-objects'
import { OrderItemKind } from './order'

export const LIQUIDATION_STATUSES = ['pendente', 'pago'] as const
export const LiquidationStatus = Schema.Literals(LIQUIDATION_STATUSES)
export type LiquidationStatus = typeof LiquidationStatus.Type

export function liquidationStatusOf(c: { liquidationStatus?: string }): LiquidationStatus {
  return c.liquidationStatus === 'pago' ? 'pago' : 'pendente'
}

export const CommissionFields = Schema.Struct({
  id: Schema.String,
  orgId: Schema.String,
  orderId: Schema.String,
  orderItemId: NonEmptyString,
  attributedUserId: NonEmptyString,
  attributedMemberName: Schema.String,
  itemKind: OrderItemKind,
  itemName: NonEmptyString,
  itemTotalCents: NonNegativeInt,
  commissionKind: Schema.Literals(['percentage', 'fixed']),
  commissionValue: Schema.Number,
  amountCents: NonNegativeInt,
  liquidationStatus: Schema.optional(LiquidationStatus),
  paidAt: Schema.optional(Schema.NullOr(Schema.String)),
  paymentProof: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.String,
}).mapFields(Struct.map(Schema.mutableKey))

export const Commission = CommissionFields.pipe(
  Schema.check(
    Schema.makeFilter(
      (c) => (liquidationStatusOf(c) === 'pago' ? c.paidAt != null : c.paidAt == null),
      {
        message: 'paidAt deve existir sse a comissão está paga',
      },
    ),
  ),
)
export type Commission = typeof Commission.Type
