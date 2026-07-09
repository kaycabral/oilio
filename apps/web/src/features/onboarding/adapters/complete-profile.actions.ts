'use server'

import { parseProfileForm } from '@/features/onboarding/core/profile-form'
import { resolveSignupOrgContext } from '@/features/onboarding/core/signup-context'
import { isUniqueViolation, USERS_MOBILE_UNIQUE } from '@/shared/db/pg/unique-violation'
import { getUserById, patchUser } from '@/shared/db/pg/users-store'
import { getSessionUser } from '@/shared/firebase/admin'
import { formString } from '@/shared/form-data'
import { logger } from '@/shared/lib/logger'
import { withActionContext } from '@/shared/lib/request-context'
import { ensureSelfSignupCustomer } from '@/shared/org/customer-upsert'
import { getOrgBySlug } from '@/shared/org/org'
import { emitClientFunnelEvent } from '@/shared/product'
import { toRoute } from '@/shared/routes'
import type { Route } from 'next'
import { redirect } from 'next/navigation'

export type CompleteProfileResult = { ok: true } | { ok: false; error: string }

export const completeProfile = withActionContext(
  async (formData: FormData): Promise<CompleteProfileResult> => {
    const session = await getSessionUser()
    if (!session) return { ok: false, error: 'Sessão expirada' }

    const user = await getUserById(session.uid)
    if (!user) return { ok: false, error: 'Usuário não encontrado' }
    if (user.completionCompleted) {
      redirect(safeNext(formData.get('next')))
    }

    const parsed = parseProfileForm(formData)
    if (typeof parsed === 'string') return { ok: false, error: parsed }
    const { name, mobile, birthDate } = parsed

    const now = new Date().toISOString()

    try {
      await patchUser(
        session.uid,
        {
          display_name: name,
          mobile,
          birth_date: birthDate,
          completion_completed: true,
        },
        now,
      )
    } catch (err) {
      if (isUniqueViolation(err, USERS_MOBILE_UNIQUE)) {
        return {
          ok: false,
          error:
            'Esse número de WhatsApp já está em uso por outra conta. Use o seu próprio número ou fale com o estabelecimento.',
        }
      }
      throw err
    }

    await materializeSelfSignupCustomer(formData, session.uid)

    redirect(safeNext(formData.get('next')))
  },
)

async function materializeSelfSignupCustomer(formData: FormData, uid: string): Promise<void> {
  const context = formString(formData, 'context').trim()
  if (context.length === 0) return
  const ctx = resolveSignupOrgContext(`/?${context}`)
  if (!ctx) return

  try {
    const org = await getOrgBySlug(ctx.orgSlug)
    if (!org) return
    const attribution = ctx.attribution
    const { customerId } = await ensureSelfSignupCustomer(org.id, uid, attribution)

    await emitClientFunnelEvent({
      event: 'client_signed_in',
      orgId: org.id,
      fromInvite: attribution.actorId !== null,
    })
    await emitClientFunnelEvent({
      event: 'client_profile_completed',
      orgId: org.id,
      customerId,
      fieldsFilled: ['name', 'mobile', 'birthDate'],
    })
  } catch (err) {
    logger.error('self-signup customer materialization failed', { scope: 'completeProfile', err })
  }
}

function safeNext(raw: FormDataEntryValue | null): Route {
  if (typeof raw !== 'string') return '/dashboard'
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/dashboard'
  return toRoute(raw)
}
