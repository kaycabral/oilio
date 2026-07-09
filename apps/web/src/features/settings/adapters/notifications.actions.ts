'use server'

import {
  isDispatchableType,
  upsertMessageTemplate,
} from '@/features/notifications/adapters/message-templates'
import { parseTemplateForm } from '@/features/settings/core/notification-template-form'
import { requireManagerCtx } from '@/shared/org/membership'
import { revalidatePath } from 'next/cache'

export type UpdateTemplateResult = { ok: true } | { ok: false; error: string }

export async function updateMessageTemplate(formData: FormData): Promise<UpdateTemplateResult> {
  const r = await requireManagerCtx()
  if (!r.ok) return r

  const parsed = parseTemplateForm(formData)
  if (typeof parsed === 'string') return { ok: false, error: parsed }

  const { type, body, enabled } = parsed
  if (!isDispatchableType(type)) return { ok: false, error: 'Tipo de notificação inválido' }

  await upsertMessageTemplate({
    orgId: r.ctx.membership.orgId,
    type,
    body,
    enabled,
    lastActorUid: r.ctx.session.uid,
    updatedAt: new Date().toISOString(),
  })

  revalidatePath('/settings/notifications')
  return { ok: true }
}
