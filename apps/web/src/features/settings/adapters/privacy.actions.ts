'use server'

import { getSessionUser } from '@/shared/firebase/admin'
import { formString } from '@/shared/form-data'
import { isLinkedToOrg } from '@/shared/identity/org-links'
import { requireOrgCtx } from '@/shared/org/membership'
import { anonymizeAccount } from '@/shared/privacy/anonymize-account'
import { blockSubjectInOrg } from '@/shared/privacy/block-subject-in-org'
import { hasActiveSubscriptionInOrg } from '@/shared/privacy/erase-customer-cascade'
import { emitPiiEvent } from '@/shared/privacy/pii-events'

// On success the erasure reports whether an active subscription was cancelled as
// part of the cascade (brief 0032 / #1101, AC-12) so the caller can confirm the
// informed-consent fact ("an active subscription was cancelled"). The
// `*WarningAction`s below surface the SAME fact BEFORE confirming, so #1097's UI
// can render the consent warning ahead of the destructive action.
export type AnonymizeAccountActionResult =
  | { ok: true; cancelledActiveSubscription: boolean }
  | { ok: false; error: string }

export type ErasureWarningResult =
  | { ok: true; hasActiveSubscription: boolean }
  | { ok: false; error: string }

// Self-service erasure (brief 0032 / AC-07): the signed-in subject deletes
// their own data. Irreversibly anonymizes the global account + the subject's
// per-org `_pii` docs (AC-01/02). Records keep their `userId` (AC-04). After
// this the account holds no PII, so the client signs the session out.
export async function deleteMyDataAction(): Promise<AnonymizeAccountActionResult> {
  const session = await getSessionUser()
  if (!session) return { ok: false, error: 'Sessão expirada' }
  if (!session.emailVerified) return { ok: false, error: 'E-mail não verificado' }

  // `pii_erasure_requested` (AC-07) — PII-free: opaque subject_ref, requested
  // by the subject themselves. Account-level erasure is cross-org (null).
  await emitPiiEvent('pii_erasure_requested', {
    orgId: null,
    subjectRef: session.uid,
    scope: 'account',
    requestedBy: session.uid,
  })
  const result = await anonymizeAccount(session.uid)
  return { ok: true, cancelledActiveSubscription: result.hadActiveSubscription }
}

// NOTE (reescopo 04/06 — decisão do owner): há intencionalmente NENHUMA ação de
// anonimização/bloqueio operada por owner/manager. A exclusão LGPD de um cliente
// é uma ação EXCLUSIVA DO TITULAR, self-service — ele age pelo próprio perfil
// (as ações abaixo). O estabelecimento nunca anonimiza um cliente (nem um membro)
// em nome dele; o vínculo profissional/trabalhista se encerra por offboarding
// (brief 0041), identificável. Ver mapa Ciclo de Vida e Exclusão.

// Per-org CUSTOMER erasure via BLOCKING (brief 0032 / AC-09). Self-service:
// the signed-in subject blocks their own CUSTOMER data in their CURRENT org
// only — the global account and any other orgs stay intact. Gated via
// `requireOrgCtx` (the subject acting on themselves, scoped to that org).
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

// Self-service per-establishment CUSTOMER erasure via BLOCKING from the privacy
// surface (brief 0032 / AC-10, #1097). The signed-in subject blocks their own
// CUSTOMER data in a SPECIFIC establishment they discovered in the reverse-index
// list — which may NOT be their `currentOrgId` (a pure customer with no
// membership). Authorization is the subject acting on THEMSELVES, scoped to a
// org their OWN `org_links` records them as a customer of — a per-user
// check, never a cross-org reach. The global account and other orgs stay
// intact.
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

// Informed-consent pre-check for the self-service per-establishment block
// (brief 0032 / AC-10 + #1101, AC-12). Reports whether the subject has an active
// subscription in the discovered establishment that the block would cancel.
// Validated against the subject's OWN reverse index (per-user). Read-only.
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

// Informed-consent pre-check (brief 0032 / #1101, AC-12). Reports whether the
// signed-in subject has an active subscription in their CURRENT org that the
// per-org block would cancel — so the UI (#1097) can warn before confirming.
// Read-only; no side effects.
export async function blockMyDataWarningAction(): Promise<ErasureWarningResult> {
  const r = await requireOrgCtx()
  if (!r.ok) return r
  const hasActive = await hasActiveSubscriptionInOrg(
    r.ctx.membership.orgId,
    r.ctx.membership.userId,
  )
  return { ok: true, hasActiveSubscription: hasActive }
}
