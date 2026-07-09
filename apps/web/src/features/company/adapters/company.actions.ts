'use server'

import { type Vertical, VERTICALS } from '@/domain'
import { OrgConfig } from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import { parseBranding, parseWebsite } from '@/features/company/core/company-form'
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
  const verticalRaw = formString(formData, 'vertical')
  if (name.length < 2) return { ok: false, error: 'Name is too short' }
  if (!isVertical(verticalRaw)) return { ok: false, error: 'Invalid vertical' }
  const vertical: Vertical = verticalRaw

  const orgId = r.ctx.membership.orgId

  const branding = parseBranding(formData)
  if (typeof branding === 'string') return { ok: false, error: branding }
  const website = parseWebsite(formData)
  if (typeof website === 'string') return { ok: false, error: website }

  const updated = await emitEvent(OrgConfig, aggregateRef(OrgConfig, orgId, orgId), {
    _tag: 'org.updated',
    actorId: r.ctx.session.uid,
    payload: {
      changes: {
        name,
        vertical,
        ...website,
        ...branding,
      },
    },
  })
  if (!updated.ok) return { ok: false, error: updated.error }

  revalidatePath('/organizations')
  return { ok: true }
}
