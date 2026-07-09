import { Schema } from 'effect'

import { NonNegativeInt } from '@/domain/value-objects'

export const CHARGE_STATUSES = [
  'scheduled',
  'paid',
  'failed',
  'recovering',
  'refunded',
  'cancelled',
] as const
export const ChargeStatus = Schema.Literal(...CHARGE_STATUSES)
export type ChargeStatus = typeof ChargeStatus.Type

export const ChargeFields = Schema.Struct({
  id: Schema.String,
  orgId: Schema.String,
  unitId: Schema.String,
  subscriptionId: Schema.String,
  customerId: Schema.String,
  amountCents: NonNegativeInt,
  periodStartAt: Schema.String,
  periodEndAt: Schema.String,
  dueDate: Schema.String,
  status: ChargeStatus,
  attempts: NonNegativeInt,
  paidAt: Schema.NullOr(Schema.String),
  failedAt: Schema.NullOr(Schema.String),
  failureReason: Schema.NullOr(Schema.String),
  refundedAt: Schema.NullOr(Schema.String),
  lastActorUid: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
})

export const Charge = Schema.mutable(
  ChargeFields.pipe(
    Schema.filter((c) => (c.status === 'paid' ? c.paidAt !== null : true), {
      message: () => 'charge paid requires paidAt',
    }),
    Schema.filter((c) => (c.status === 'refunded' ? c.refundedAt !== null : true), {
      message: () => 'charge refunded requires refundedAt',
    }),
  ),
)
export type Charge = typeof Charge.Type
