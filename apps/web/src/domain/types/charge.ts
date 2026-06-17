import { Schema } from 'effect'

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

export const Charge = Schema.mutable(
  Schema.Struct({
    id: Schema.String,
    tenantId: Schema.String,
    // Snapshot do `unitId` da assinatura no ciclo (brief 0043). Capturado na
    // criação/renovação do Charge — recebíveis por unidade derivam daqui.
    unitId: Schema.String,
    subscriptionId: Schema.String,
    customerId: Schema.String,
    amountCents: Schema.Number,
    // Janela coberta por essa cobrança (espelha o SubscriptionPeriod aberto
    // quando ela foi criada). Útil pra calendário de recebíveis + tracking
    // de inadimplência (qual ciclo está em recuperação).
    periodStartAt: Schema.String,
    periodEndAt: Schema.String,
    // ISO UTC do vencimento da cobrança. Calendário de recebíveis lista por
    // dueDate. Em renewSubscription o sistema cria o próximo charge com
    // dueDate = currentPeriod.endAt + 1 dia.
    dueDate: Schema.String,
    status: ChargeStatus,
    attempts: Schema.Number,
    paidAt: Schema.NullOr(Schema.String),
    failedAt: Schema.NullOr(Schema.String),
    failureReason: Schema.NullOr(Schema.String),
    // Quem disparou ações manuais (mark_paid/mark_failed). null = ação automática
    // de cron/webhook.
    lastActorUid: Schema.NullOr(Schema.String),
    createdAt: Schema.String,
    updatedAt: Schema.String,
  }),
)
export type Charge = typeof Charge.Type
