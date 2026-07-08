import { Charge, ChargeFields } from '@/domain/types/charge'
import { Schema } from 'effect'

export const ChargeCreatedSchema = Schema.Struct({
  _tag: Schema.Literal('charge.created'),
  // `data` é o `Charge` COMPLETO (com a invariante estado→timestamp refinada).
  data: Charge,
})

// `changes` deriva do struct base (sem o refinamento) — um changeset é parcial e
// não comporta a invariante completa; ela vale no estado final (reducer + CHECK).
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

// Estorno de uma cobrança já liquidada (ADR 0016 D5). Antes o `status='refunded'`
// era alcançável sem evento produtor (violava "sem mudança de estado sem evento",
// ADR 0010) — o Razão não tinha fato de onde derivar a contrapartida. Agora o
// refund é um evento de primeira classe: `changes` carrega `status:'refunded'` +
// `refundedAt` (competência do estorno). Quando o produtor real existir, o
// changeset TAMBÉM deve carregar `amountCents` + `unitId` (simetria com
// `charge.succeeded`, ADR 0016 D5): o Razão deriva a contrapartida do evento só,
// sem buscar o `charge.created`. O fluxo real espera a parceria de pagamento
// (gateway kill-switch) — modelado agora, E2E quando o gateway ligar.
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
