import { Schema } from 'effect'

import { NonNegativeInt } from '@/domain/value-objects'

// Ciclo de vida de cada cobrança vinculada a um Subscription.
// - scheduled: prevista, dueDate no futuro.
// - paid: liquidada (manual ou retorno do gateway).
// - failed: tentativa falhou (cartão recusado, saldo insuficiente, etc.).
// - recovering: marcada pra retry — sistema (ou owner) vai tentar de novo.
// - refunded: estornada após cobrança.
// - cancelled: cancelada antes de cobrar (ex.: cliente cancelou no início do ciclo).
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

// Struct base SEM o refinamento de invariante — é o que `Schema.partial` (o
// changeset `changes` dos eventos) consome: um changeset é parcial por natureza e
// não carrega a invariante estado→timestamp (que vale no estado final, garantida
// pelo `Charge` refinado no `charge.created.data` + o reducer + o CHECK do banco).
// `Schema.partial` só aceita Struct, não Refinement — daí a separação.
export const ChargeFields = Schema.Struct({
  id: Schema.String,
  orgId: Schema.String,
  // Snapshot do `unitId` da assinatura no ciclo (brief 0043). Capturado na
  // criação/renovação do Charge — recebíveis por unidade derivam daqui.
  unitId: Schema.String,
  subscriptionId: Schema.String,
  customerId: Schema.String,
  amountCents: NonNegativeInt,
  // Janela coberta por essa cobrança (espelha o SubscriptionPeriod aberto
  // quando ela foi criada). Útil pra calendário de recebíveis + tracking
  // de inadimplência (qual ciclo está em recuperação). É também a COMPETÊNCIA
  // da receita de assinatura no Razão (reconhecida ao longo do período de
  // serviço, ADR 0016 D2), não a data de pagamento.
  periodStartAt: Schema.String,
  periodEndAt: Schema.String,
  // ISO UTC do vencimento da cobrança. Calendário de recebíveis lista por
  // dueDate. Em renewSubscription o sistema cria o próximo charge com
  // dueDate = currentPeriod.endAt + 1 dia.
  dueDate: Schema.String,
  status: ChargeStatus,
  attempts: NonNegativeInt,
  paidAt: Schema.NullOr(Schema.String),
  failedAt: Schema.NullOr(Schema.String),
  failureReason: Schema.NullOr(Schema.String),
  // ISO UTC do estorno (ADR 0016 D5). Não-nulo SSE `status === 'refunded'` —
  // um refund SEM data é irrepresentável (invariante abaixo + CHECK no banco).
  refundedAt: Schema.NullOr(Schema.String),
  // Quem disparou ações manuais (mark_paid/mark_failed). null = ação automática
  // de cron/webhook.
  lastActorUid: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
})

// Invariante de estado→timestamp (CLAUDE.md do domínio § "campo obrigatório vive
// no núcleo"): uma charge `paid` SEM `paidAt`, ou `refunded` SEM `refundedAt`, é
// irrepresentável. A defesa mora no schema (borda do decode em `appendEventToTx`)
// + CHECK condicional no banco — não só no form. Regime de caixa disfarçado (D2)
// e refund sem competência (D5) ficam barrados na origem.
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
