import { CashMovement } from '@/domain/types/cash-movement'
import { Schema } from 'effect'

export const CashMovementCreatedSchema = Schema.Struct({
  _tag: Schema.Literal('cash_movement.created'),
  data: CashMovement,
})

export const CashMovementEventSchema = CashMovementCreatedSchema

export type CashMovementCreated = typeof CashMovementCreatedSchema.Type
export type CashMovementEvent = typeof CashMovementEventSchema.Type
