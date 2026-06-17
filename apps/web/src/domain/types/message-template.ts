// MessageTemplate — texto editável pelo owner, renderizado no envio de
// notificação (wa.me hoje; outros canais no futuro). Persistência: config-doc
// `tenants/{tid}/message_templates/{type}` (NÃO aggregate ES — ver brief 0018
// § Riscos, decisão 2026-05-28). Espelha o pattern de `Tenant.whatsappTemplates`.

import { Schema } from 'effect'

import type { NotificationType } from '../aggregates/notification/types'

// `NotificationType` is a hand-written `type` in the notification aggregate
// (outside the read-model kernel). Projected here so `MessageTemplate.type` has
// a schema source of truth; the `_proof` pins it to the canonical type.
const NotificationTypeSchema = Schema.Literal(
  'birthday',
  'subscription_expiring_tomorrow',
  'subscription_expired',
  'subscription_overdue_followup',
  'order_stale',
  'cash_register_open',
  'new_customer',
  'payment_failure',
)
type _ProofNotificationType = [
  typeof NotificationTypeSchema.Type extends NotificationType ? true : false,
  NotificationType extends typeof NotificationTypeSchema.Type ? true : false,
]
const _proofNotificationType: _ProofNotificationType = [true, true]
void _proofNotificationType

export const MessageTemplate = Schema.mutable(
  Schema.Struct({
    id: Schema.String,
    tenantId: Schema.String,
    type: NotificationTypeSchema,
    body: Schema.String,
    enabled: Schema.Boolean,
    updatedAt: Schema.String,
    lastActorUid: Schema.NullOr(Schema.String),
  }),
)
export type MessageTemplate = typeof MessageTemplate.Type

// Tipos de notificação que viram mensagem pro cliente (têm template editável +
// ação wa.me). Os demais (order_stale, cash_register_open, payment_failure) são
// alertas operacionais internos — sem mensagem ao cliente.
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

// Placeholders suportados nos templates. Documentados pro owner na UI.
export const NOTIFICATION_TEMPLATE_PLACEHOLDERS = [
  '{cliente_nome}',
  '{servico}',
  '{valor}',
  '{voucher_atual}',
] as const

export const NotificationTemplateVars = Schema.mutable(
  Schema.Struct({
    cliente_nome: Schema.optional(Schema.String),
    servico: Schema.optional(Schema.String),
    valor: Schema.optional(Schema.String),
    voucher_atual: Schema.optional(Schema.String),
  }),
)
export type NotificationTemplateVars = typeof NotificationTemplateVars.Type

// Templates default por tipo — pt-BR, reproduzindo o estilo da Aurora (positivo
// + voucher pré-vencimento; neutro pós; re-engajamento no follow-up). Decisão
// V1 calibrada com mensagens reais (brief 0018 § Riscos, janela de vencimento).
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

// Substitui `{key}` pelo valor correspondente; chave ausente/vazia vira string
// vazia (mensagem lê natural em vez de "{undefined}"). Mesmo mecanismo do
// renderWhatsappTemplate, mas com vars pt-BR específicas de notificação.
export function renderNotificationTemplate(body: string, vars: NotificationTemplateVars): string {
  const lookup = new Map(Object.entries(vars))
  return body.replace(/\{(\w+)\}/g, (_match, key: string) => lookup.get(key) ?? '')
}
