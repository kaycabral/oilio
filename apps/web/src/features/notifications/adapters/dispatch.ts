import {
  buildWhatsappLink,
  renderNotificationTemplate,
  type NotificationTemplateVars,
} from '@/domain'
import { NotificationConfig } from '@/domain/aggregates'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import { emitEvent } from '@/shared/effect-bridge'
import { getCustomerById } from '@/shared/org/customer-read'
import { Schema } from 'effect'
import { isDispatchableType, resolveTemplateBody } from './message-templates'

export type DispatchResult = { ok: true; link: string } | { ok: false; error: string }

const StoredDispatchNotification = Schema.Struct({
  type: Schema.optional(Schema.String),
  customerId: Schema.optional(Schema.NullOr(Schema.String)),
  payload: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
})

// AC-14: renderiza o template do tipo com dados reais do customer, monta o link
// wa.me, e grava notification.dispatched com snapshot (channel + body NÃO
// renderizado). Body renderizado vai só pro link; o snapshot guarda a receita.
export async function dispatchNotificationWhatsapp(
  orgId: string,
  notificationId: string,
  actorUid: string,
): Promise<DispatchResult> {
  const db = getAdminFirestore()
  const notifSnap = await db
    .collection('orgs')
    .doc(orgId)
    .collection('notifications')
    .doc(notificationId)
    .withConverter(fsConverter(StoredDispatchNotification))
    .get()

  if (!notifSnap.exists) return { ok: false, error: 'Notificação não encontrada' }
  const notif = notifSnap.data() ?? {}
  const type = notif.type ?? ''

  if (!isDispatchableType(type)) {
    return { ok: false, error: 'Esse tipo de notificação não envia mensagem ao cliente' }
  }
  const dispatchableType = type

  const customerId = notif.customerId ?? null
  if (!customerId) return { ok: false, error: 'Notificação sem cliente associado' }

  const customer = await getCustomerById(orgId, customerId)
  if (!customer) return { ok: false, error: 'Cliente não encontrado' }
  if (!customer.whatsapp) return { ok: false, error: 'Cliente sem WhatsApp cadastrado' }

  const body = await resolveTemplateBody(orgId, dispatchableType)

  const payload = notif.payload ?? {}
  const vars: NotificationTemplateVars = {
    cliente_nome: customer.name,
    servico: typeof payload.servico === 'string' ? payload.servico : undefined,
    valor: typeof payload.valor === 'string' ? payload.valor : undefined,
    voucher_atual: typeof payload.voucher_atual === 'string' ? payload.voucher_atual : undefined,
  }

  const rendered = renderNotificationTemplate(body, vars)
  const link = buildWhatsappLink(customer.whatsapp, rendered)
  if (!link) return { ok: false, error: 'WhatsApp do cliente é inválido' }

  // Snapshot: body NÃO-renderizado (chave de variante) + canal.
  const result = await emitEvent(
    NotificationConfig,
    `orgs/${orgId}/notifications/${notificationId}`,
    {
      _tag: 'notification.dispatched',
      actorId: actorUid,
      payload: { channel: 'wa_link', templateBody: body },
    },
  )
  if (!result.ok) return { ok: false, error: result.error }

  return { ok: true, link }
}
