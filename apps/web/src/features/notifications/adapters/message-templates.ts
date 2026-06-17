import {
  DEFAULT_NOTIFICATION_TEMPLATES,
  DISPATCHABLE_NOTIFICATION_TYPES,
  defaultTemplateBody,
  isDispatchableType,
  type DispatchableNotificationType,
  type MessageTemplate,
} from '@/domain'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import { Schema } from 'effect'

const StoredMessageTemplate = Schema.Struct({
  body: Schema.optional(Schema.String),
  enabled: Schema.optional(Schema.Boolean),
  updatedAt: Schema.optional(Schema.String),
  lastActorUid: Schema.optional(Schema.String),
})

function templatesRef(tenantId: string) {
  return getAdminFirestore().collection('tenants').doc(tenantId).collection('message_templates')
}

// Lê o template config-doc de um tipo. null quando o owner nunca customizou.
export async function getMessageTemplate(
  tenantId: string,
  type: DispatchableNotificationType,
): Promise<MessageTemplate | null> {
  const snap = await templatesRef(tenantId)
    .doc(type)
    .withConverter(fsConverter(StoredMessageTemplate))
    .get()
  if (!snap.exists) return null
  const d = snap.data() ?? {}
  return {
    id: type,
    tenantId,
    type,
    body: d.body ?? DEFAULT_NOTIFICATION_TEMPLATES[type],
    enabled: d.enabled ?? true,
    updatedAt: d.updatedAt ?? '',
    lastActorUid: d.lastActorUid ?? null,
  }
}

// Body efetivo pra render: custom do owner se existe + enabled, senão default.
export async function resolveTemplateBody(
  tenantId: string,
  type: DispatchableNotificationType,
): Promise<string> {
  const tpl = await getMessageTemplate(tenantId, type)
  if (tpl && tpl.enabled && tpl.body.trim().length > 0) return tpl.body
  return defaultTemplateBody(type)
}

// Lista todos os templates dispatchable do tenant (custom ou default) — usado
// pela página /settings/notifications.
export async function listMessageTemplates(tenantId: string): Promise<MessageTemplate[]> {
  const docs = await Promise.all(
    DISPATCHABLE_NOTIFICATION_TYPES.map((type) => getMessageTemplate(tenantId, type)),
  )
  return DISPATCHABLE_NOTIFICATION_TYPES.map((type, i) => {
    const existing = docs[i]
    if (existing) return existing
    return {
      id: type,
      tenantId,
      type,
      body: DEFAULT_NOTIFICATION_TEMPLATES[type],
      enabled: true,
      updatedAt: '',
      lastActorUid: null,
    }
  })
}

export { isDispatchableType }
