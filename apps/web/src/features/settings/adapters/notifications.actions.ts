'use server'

import {
  isDispatchableType,
  upsertMessageTemplate,
} from '@/features/notifications/adapters/message-templates'
import { parseTemplateForm } from '@/features/settings/core/notification-template-form'
import { requireManagerCtx } from '@/shared/org/membership'
import { revalidatePath } from 'next/cache'

export type UpdateTemplateResult = { ok: true } | { ok: false; error: string }

// AC-13: owner/manager edita o template de um tipo. Config-doc — upsert direto
// + audit via updatedAt/lastActorUid no próprio registro (decisão 2026-05-28,
// brief 0018 § Riscos). Gate manager+ no server action (AC-20 cobre read-only de
// receptionist em sub-issue separada). Pós-cutover: Postgres `message_templates`
// sob RLS org-scoped.
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
