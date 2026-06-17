'use server'

import { parseTemplateForm } from '@/features/settings/core/notification-template-form'
import { getAdminFirestore } from '@/shared/db'
import { requireManagerCtx } from '@/shared/tenant/membership'
import { revalidatePath } from 'next/cache'

export type UpdateTemplateResult = { ok: true } | { ok: false; error: string }

// AC-13: owner/manager edita o template de um tipo. Config-doc — `.set()` direto
// + audit via updatedAt/lastActorUid no próprio doc (decisão 2026-05-28, brief
// 0018 § Riscos). Gate manager+ no server action (AC-20 cobre read-only de
// receptionist em sub-issue separada).
export async function updateMessageTemplate(formData: FormData): Promise<UpdateTemplateResult> {
  const r = await requireManagerCtx()
  if (!r.ok) return r

  const parsed = parseTemplateForm(formData)
  if (typeof parsed === 'string') return { ok: false, error: parsed }

  const { type, body, enabled } = parsed
  const tenantId = r.ctx.membership.tenantId

  await getAdminFirestore()
    .collection('tenants')
    .doc(tenantId)
    .collection('message_templates')
    .doc(type)
    .set({
      id: type,
      tenantId,
      type,
      body,
      enabled,
      updatedAt: new Date().toISOString(),
      lastActorUid: r.ctx.session.uid,
    })

  revalidatePath('/settings/notifications')
  return { ok: true }
}
