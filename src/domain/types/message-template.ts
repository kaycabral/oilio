import { Schema, Struct } from 'effect'

import type { NotificationType } from '../aggregates/notification/types'

const NotificationTypeSchema = Schema.Literals([
  'birthday',
  'subscription_expiring_tomorrow',
  'subscription_expired',
  'subscription_overdue_followup',
  'order_stale',
  'cash_register_open',
  'new_customer',
  'payment_failure',
])
type _ProofNotificationType = [
  typeof NotificationTypeSchema.Type extends NotificationType ? true : false,
  NotificationType extends typeof NotificationTypeSchema.Type ? true : false,
]
const _proofNotificationType: _ProofNotificationType = [true, true]
void _proofNotificationType

export const MessageTemplate = Schema.Struct({
  id: Schema.String,
  orgId: Schema.String,
  type: NotificationTypeSchema,
  body: Schema.String,
  enabled: Schema.Boolean,
  updatedAt: Schema.String,
  lastActorUid: Schema.NullOr(Schema.String),
}).mapFields(Struct.map(Schema.mutableKey))
export type MessageTemplate = typeof MessageTemplate.Type

export const DISPATCHABLE_NOTIFICATION_TYPES = [
  'birthday',
  'subscription_expiring_tomorrow',
  'subscription_expired',
  'subscription_overdue_followup',
  'new_customer',
] as const satisfies readonly NotificationType[]

export type DispatchableNotificationType = (typeof DISPATCHABLE_NOTIFICATION_TYPES)[number]

export function isDispatchableType(type: string): type is DispatchableNotificationType {
  return DISPATCHABLE_NOTIFICATION_TYPES.some((t) => t === type)
}

export const NOTIFICATION_TEMPLATE_PLACEHOLDERS = [
  '{cliente_nome}',
  '{servico}',
  '{valor}',
  '{voucher_atual}',
] as const

export const NotificationTemplateVars = Schema.Struct({
  cliente_nome: Schema.optional(Schema.String),
  servico: Schema.optional(Schema.String),
  valor: Schema.optional(Schema.String),
  voucher_atual: Schema.optional(Schema.String),
}).mapFields(Struct.map(Schema.mutableKey))
export type NotificationTemplateVars = typeof NotificationTemplateVars.Type

export const DEFAULT_NOTIFICATION_TEMPLATES: Record<DispatchableNotificationType, string> = {
  birthday:
    'Olá {cliente_nome}! 🎉 Hoje é seu dia e a gente queria te desejar tudo de bom! Que tal comemorar com um {servico}? Te esperamos por aqui. 💈',
  subscription_expiring_tomorrow:
    'Oi {cliente_nome}, tudo bem? 💈 Sua assinatura vence amanhã. Renovando hoje você ganha {voucher_atual} 🤩 Bora garantir?',
  subscription_expired:
    'Olá {cliente_nome}! Sua assinatura venceu ontem. Quer renovar pra não perder seus horários? É só me responder por aqui que eu te ajudo. 🙌',
  subscription_overdue_followup:
    'Oi {cliente_nome}, senti sua falta por aqui! 💈 Sua assinatura está parada há alguns dias — bora reativar? Me chama que a gente resolve rapidinho.',
  new_customer:
    'Olá {cliente_nome}, seja muito bem-vindo(a)! 💈 Qualquer dúvida sobre horários ou serviços é só me chamar por aqui. Será um prazer te atender!',
}

export function defaultTemplateBody(type: DispatchableNotificationType): string {
  return DEFAULT_NOTIFICATION_TEMPLATES[type]
}

export function renderNotificationTemplate(body: string, vars: NotificationTemplateVars): string {
  const lookup = new Map(Object.entries(vars))
  return body.replace(/\{(\w+)\}/g, (_match, key: string) => lookup.get(key) ?? '')
}
