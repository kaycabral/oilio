'use server'

import { isValidSlug, type Vertical, VERTICALS } from '@/domain'
import { OrgConfig } from '@/domain/aggregates'
import { parseBranding } from '@/features/company/core/company-form'
import { getAdminFirestore } from '@/shared/db'
import { emitEvent } from '@/shared/effect-bridge'
import { formString } from '@/shared/form-data'
import { requireManagerCtx } from '@/shared/org/membership'
import { revalidatePath } from 'next/cache'

function isVertical(value: string): value is Vertical {
  return (VERTICALS as readonly string[]).includes(value)
}

export type UpdateCompanyResult = { ok: true } | { ok: false; error: string }

export async function updateCompany(formData: FormData): Promise<UpdateCompanyResult> {
  const r = await requireManagerCtx()
  if (!r.ok) return r

  const name = formString(formData, 'name').trim()
  const slug = formString(formData, 'slug').trim().toLowerCase()
  const verticalRaw = formString(formData, 'vertical')
  if (name.length < 2) return { ok: false, error: 'Name is too short' }
  if (!isValidSlug(slug)) {
    return { ok: false, error: 'Slug deve ter 3+ caracteres: minúsculas, dígitos e hífens' }
  }
  if (!isVertical(verticalRaw)) return { ok: false, error: 'Invalid vertical' }
  const vertical: Vertical = verticalRaw

  const db = getAdminFirestore()
  const orgId = r.ctx.membership.orgId
  const slugTaken = await db.collection('orgs').where('slug', '==', slug).limit(1).get()
  if (!slugTaken.empty && slugTaken.docs[0]?.id !== orgId) {
    return { ok: false, error: 'Slug já está em uso' }
  }

  // Fiscal identity is NOT edited here (brief 0048): formalization happens via
  // the dedicated Formalizar flow on the unit. Agenda/self-booking config
  // (cancellation policy, confirmation messages, slot, self-booking publish)
  // moved Org→Unit (PRD Identidade v2) and is edited per-unit, not here. The Org
  // is a pure folder: this action edits only name/slug/segment/branding.
  const branding = parseBranding(formData)
  if (typeof branding === 'string') return { ok: false, error: branding }

  // Event-first: estado da empresa vem do evento (sem `.update` paralelo); o
  // reducer projeta todas as mudanças.
  const updated = await emitEvent(OrgConfig, `orgs/${orgId}`, {
    _tag: 'org.updated',
    actorId: r.ctx.session.uid,
    payload: {
      changes: {
        name,
        slug,
        vertical,
        ...branding,
      },
    },
  })
  if (!updated.ok) return { ok: false, error: updated.error }

  revalidatePath('/company')
  return { ok: true }
}
