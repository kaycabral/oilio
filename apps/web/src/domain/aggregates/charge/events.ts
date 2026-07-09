import { Charge, ChargeFields } from '@/domain/types/charge'
import { Schema } from 'effect'

export const ChargeCreatedSchema = Schema.Struct({
  _tag: Schema.Literal('charge.created'),
  data: Charge,
})

const ChargeChanges = Schema.partial(ChargeFields)

export const ChargeSucceededSchema = Schema.Struct({
  _tag: Schema.Literal('charge.succeeded'),
  changes: ChargeChanges,
})

export const ChargeFailedSchema = Schema.Struct({
  _tag: Schema.Literal('charge.failed'),
  changes: ChargeChanges,
})

export const ChargeCancelledSchema = Schema.Struct({
  _tag: Schema.Literal('charge.cancelled'),
  changes: ChargeChanges,
})

export const ChargeRefundedSchema = Schema.Struct({
  _tag: Schema.Literal('charge.refunded'),
  changes: ChargeChanges,
})

export const ChargeEventSchema = Schema.Union(
  ChargeCreatedSchema,
  ChargeSucceededSchema,
  ChargeFailedSchema,
  ChargeCancelledSchema,
  ChargeRefundedSchema,
)

export type ChargeCreated = typeof ChargeCreatedSchema.Type
export type ChargeSucceeded = typeof ChargeSucceededSchema.Type
export type ChargeFailed = typeof ChargeFailedSchema.Type
export type ChargeCancelled = typeof ChargeCancelledSchema.Type
export type ChargeRefunded = typeof ChargeRefundedSchema.Type
export type ChargeEvent = typeof ChargeEventSchema.Type
