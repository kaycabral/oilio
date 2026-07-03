import {
  buildWhatsappLink,
  renderNotificationTemplate,
  type NotificationTemplateVars,
} from '@/domain'
import { NotificationConfig } from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import { emitEvent } from '@/shared/effect-bridge'
import { getCustomerById } from '@/shared/org/customer-read'
import { getNotificationById } from '@/shared/org/notification-read'
import { isDispatchableType, resolveTemplateBody } from './message-templates'

export type DispatchResult = { ok: true; link: string } | { ok: false; error: string }

// AC-14: renderiza o template do tipo com dados reais do customer, monta o link
// wa.me, e grava notification.dispatched com snapshot (channel + body NÃO
// renderizado). Body renderizado vai só pro link; o snapshot guarda a receita.
// Backend-aware (brief 0060, Grupo C): a notificação é lida por
// `getNotificationById` (Postgres typed table sob RLS, ou Firestore).
export async function dispatchNotificationWhatsapp(
  orgId: string,
  notificationId: string,
  actorUid: string,
): Promise<DispatchResult> {
  const notif = await getNotificationById(orgId, notificationId)
  if (!notif) return { ok: false, error: 'Notificação não encontrada' }
  const type = typeof notif['type'] === 'string' ? notif['type'] : ''

  if (!isDispatchableType(type)) {
    return { ok: false, error: 'Esse tipo de notificação não envia mensagem ao cliente' }
  }
  const dispatchableType = type

  const customerId = typeof notif['customerId'] === 'string' ? notif['customerId'] : null
  if (!customerId) return { ok: false, error: 'Notificação sem cliente associado' }

  const customer = await getCustomerById(orgId, customerId)
  if (!customer) return { ok: false, error: 'Cliente não encontrado' }
  if (!customer.mobile) return { ok: false, error: 'Cliente sem WhatsApp cadastrado' }

  const body = await resolveTemplateBody(orgId, dispatchableType)

  // `payload` is `unknown` on the FirestoreDoc; spread it into a plain record so
  // each field read stays a guarded `unknown` access (no whole-object assertion).
  // Exclude arrays — a `{ ...array }` would yield numeric-keyed entries and the
  // template vars below would silently read undefined; only a plain object is a
  // valid payload shape.
  const rawPayload = notif['payload']
  const payload: Record<string, unknown> =
    rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload)
      ? { ...rawPayload }
      : {}
  const vars: NotificationTemplateVars = {
    cliente_nome: customer.name,
    servico: typeof payload['servico'] === 'string' ? payload['servico'] : undefined,
    valor: typeof payload['valor'] === 'string' ? payload['valor'] : undefined,
    voucher_atual:
      typeof payload['voucher_atual'] === 'string' ? payload['voucher_atual'] : undefined,
  }

  const rendered = renderNotificationTemplate(body, vars)
  const link = buildWhatsappLink(customer.mobile, rendered)
  if (!link) return { ok: false, error: 'WhatsApp do cliente é inválido' }

  // Snapshot: body NÃO-renderizado (chave de variante) + canal.
  const result = await emitEvent(
    NotificationConfig,
    aggregateRef(NotificationConfig, orgId, notificationId),
    {
      _tag: 'notification.dispatched',
      actorId: actorUid,
      payload: { channel: 'wa_link', templateBody: body },
    },
  )
  if (!result.ok) return { ok: false, error: result.error }

  return { ok: true, link }
}
