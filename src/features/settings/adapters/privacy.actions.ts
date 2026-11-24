'use server'

import { deleteAuthUser } from '@/shared/auth/admin'
import { getSessionUser } from '@/shared/auth/session'
import { formString } from '@/shared/form-data'
import { isLinkedToOrg } from '@/shared/identity/org-links'
import { requireOrgCtx } from '@/shared/org/membership'
import { anonymizeAccount } from '@/shared/privacy/anonymize-account'
import { blockSubjectInOrg } from '@/shared/privacy/block-subject-in-org'
import { hasActiveSubscriptionInOrg } from '@/shared/privacy/erase-customer-cascade'
import { emitPiiEvent } from '@/shared/privacy/pii-events'

export type AnonymizeAccountActionResult =
  { ok: true; cancelledActiveSubscription: boolean } | { ok: false; error: string }

export type ErasureWarningResult =
  { ok: true; hasActiveSubscription: boolean } | { ok: false; error: string }

export async function deleteMyDataAction(): Promise<AnonymizeAccountActionResult> {
  const session = await getSessionUser()
  if (!session) return { ok: false, error: 'Sessão expirada' }
  if (!session.emailVerified) return { ok: false, error: 'E-mail não verificado' }

  await emitPiiEvent('pii_erasure_requested', {
    orgId: null,
    subjectRef: session.uid,
    scope: 'account',
    requestedBy: session.uid,
  })
  const result = await anonymizeAccount(session.uid)
  await deleteAuthUser(session.authUserId)
  return { ok: true, cancelledActiveSubscription: result.hadActiveSubscription }
}

export async function blockMyDataInOrgAction(): Promise<AnonymizeAccountActionResult> {
  const r = await requireOrgCtx()
  if (!r.ok) return r

  const orgId = r.ctx.membership.orgId
  const subjectUserId = r.ctx.membership.userId

  await emitPiiEvent('pii_erasure_requested', {
    orgId,
    subjectRef: subjectUserId,
    scope: 'account',
    requestedBy: subjectUserId,
  })
  const result = await blockSubjectInOrg(orgId, subjectUserId)
  return { ok: true, cancelledActiveSubscription: result.hadActiveSubscription }
}

export async function blockMyDataInEstablishmentAction(
  formData: FormData,
): Promise<AnonymizeAccountActionResult> {
  const session = await getSessionUser()
  if (!session) return { ok: false, error: 'Sessão expirada' }
  if (!session.emailVerified) return { ok: false, error: 'E-mail não verificado' }

  const orgId = formString(formData, 'orgId').trim()
  if (!orgId) return { ok: false, error: 'Estabelecimento não informado' }
  if (!(await isLinkedToOrg(session.uid, orgId))) {
    return { ok: false, error: 'Você não é cliente deste estabelecimento' }
  }

  await emitPiiEvent('pii_erasure_requested', {
    orgId,
    subjectRef: session.uid,
    scope: 'account',
    requestedBy: session.uid,
  })
  const result = await blockSubjectInOrg(orgId, session.uid)
  return { ok: true, cancelledActiveSubscription: result.hadActiveSubscription }
}

export async function blockMyDataInEstablishmentWarningAction(
  formData: FormData,
): Promise<ErasureWarningResult> {
  const session = await getSessionUser()
  if (!session) return { ok: false, error: 'Sessão expirada' }
  if (!session.emailVerified) return { ok: false, error: 'E-mail não verificado' }

  const orgId = formString(formData, 'orgId').trim()
  if (!orgId) return { ok: false, error: 'Estabelecimento não informado' }
  if (!(await isLinkedToOrg(session.uid, orgId))) {
    return { ok: false, error: 'Você não é cliente deste estabelecimento' }
  }

  const hasActive = await hasActiveSubscriptionInOrg(orgId, session.uid)
  return { ok: true, hasActiveSubscription: hasActive }
}

export async function blockMyDataWarningAction(): Promise<ErasureWarningResult> {
  const r = await requireOrgCtx()
  if (!r.ok) return r
  const hasActive = await hasActiveSubscriptionInOrg(
    r.ctx.membership.orgId,
    r.ctx.membership.userId,
  )
  return { ok: true, hasActiveSubscription: hasActive }
}
