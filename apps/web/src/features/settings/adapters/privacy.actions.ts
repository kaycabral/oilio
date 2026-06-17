'use server'

import { getSessionUser } from '@/shared/firebase/admin'
import { formString } from '@/shared/form-data'
import { isLinkedToTenant } from '@/shared/identity/tenant-links'
import { anonymizeAccount } from '@/shared/privacy/anonymize-account'
import { blockSubjectInTenant } from '@/shared/privacy/block-subject-in-tenant'
import { hasActiveSubscriptionInTenant } from '@/shared/privacy/erase-customer-cascade'
import { emitPiiEvent } from '@/shared/privacy/pii-events'
import { requireTenantCtx } from '@/shared/tenant/membership'

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
// per-tenant `_pii` docs (AC-01/02). Records keep their `userId` (AC-04). After
// this the account holds no PII, so the client signs the session out.
export async function deleteMyDataAction(): Promise<AnonymizeAccountActionResult> {
  const session = await getSessionUser()
  if (!session) return { ok: false, error: 'Sessão expirada' }
  if (!session.emailVerified) return { ok: false, error: 'E-mail não verificado' }

  // `pii_erasure_requested` (AC-07) — PII-free: opaque subject_ref, requested
  // by the subject themselves. Account-level erasure is cross-tenant (null).
  await emitPiiEvent('pii_erasure_requested', {
    tenantId: null,
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

// Per-tenant CUSTOMER erasure via BLOCKING (brief 0032 / AC-09). Self-service:
// the signed-in subject blocks their own CUSTOMER data in their CURRENT tenant
// only — the global account and any other tenants stay intact. Gated via
// `requireTenantCtx` (the subject acting on themselves, scoped to that tenant).
export async function blockMyDataInTenantAction(): Promise<AnonymizeAccountActionResult> {
  const r = await requireTenantCtx()
  if (!r.ok) return r

  const tenantId = r.ctx.membership.tenantId
  const subjectUserId = r.ctx.membership.userId

  await emitPiiEvent('pii_erasure_requested', {
    tenantId,
    subjectRef: subjectUserId,
    scope: 'account',
    requestedBy: subjectUserId,
  })
  const result = await blockSubjectInTenant(tenantId, subjectUserId)
  return { ok: true, cancelledActiveSubscription: result.hadActiveSubscription }
}

// Self-service per-establishment CUSTOMER erasure via BLOCKING from the privacy
// surface (brief 0032 / AC-10, #1097). The signed-in subject blocks their own
// CUSTOMER data in a SPECIFIC establishment they discovered in the reverse-index
// list — which may NOT be their `currentTenantId` (a pure customer with no
// membership). Authorization is the subject acting on THEMSELVES, scoped to a
// tenant their OWN `tenant_links` records them as a customer of — a per-user
// check, never a cross-tenant reach. The global account and other tenants stay
// intact.
export async function blockMyDataInEstablishmentAction(
  formData: FormData,
): Promise<AnonymizeAccountActionResult> {
  const session = await getSessionUser()
  if (!session) return { ok: false, error: 'Sessão expirada' }
  if (!session.emailVerified) return { ok: false, error: 'E-mail não verificado' }

  const tenantId = formString(formData, 'tenantId').trim()
  if (!tenantId) return { ok: false, error: 'Estabelecimento não informado' }
  if (!(await isLinkedToTenant(session.uid, tenantId))) {
    return { ok: false, error: 'Você não é cliente deste estabelecimento' }
  }

  await emitPiiEvent('pii_erasure_requested', {
    tenantId,
    subjectRef: session.uid,
    scope: 'account',
    requestedBy: session.uid,
  })
  const result = await blockSubjectInTenant(tenantId, session.uid)
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

  const tenantId = formString(formData, 'tenantId').trim()
  if (!tenantId) return { ok: false, error: 'Estabelecimento não informado' }
  if (!(await isLinkedToTenant(session.uid, tenantId))) {
    return { ok: false, error: 'Você não é cliente deste estabelecimento' }
  }

  const hasActive = await hasActiveSubscriptionInTenant(tenantId, session.uid)
  return { ok: true, hasActiveSubscription: hasActive }
}

// Informed-consent pre-check (brief 0032 / #1101, AC-12). Reports whether the
// signed-in subject has an active subscription in their CURRENT tenant that the
// per-tenant block would cancel — so the UI (#1097) can warn before confirming.
// Read-only; no side effects.
export async function blockMyDataWarningAction(): Promise<ErasureWarningResult> {
  const r = await requireTenantCtx()
  if (!r.ok) return r
  const hasActive = await hasActiveSubscriptionInTenant(
    r.ctx.membership.tenantId,
    r.ctx.membership.userId,
  )
  return { ok: true, hasActiveSubscription: hasActive }
}
