'use server'

import { CustomerConfig } from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import { parseCustomerForm } from '@/features/customers/core/customer-form'
import { deleteOrgProjectionDoc } from '@/shared/db/effect/delete-projection'
import { isForeignKeyViolation } from '@/shared/db/pg/fk-violation'
import { emitEvent } from '@/shared/effect-bridge'
import { formString } from '@/shared/form-data'
import { buildClientInviteWhatsapp } from '@/shared/invite/client-invite'
import { getCustomerUserId } from '@/shared/org/customer-read'
import { updateCustomerPii } from '@/shared/org/customer-upsert'
import { getCustomerDeletionImpact, type CustomerDeletionImpact } from '@/shared/org/delete-guard'
import { AuthzError, guardCapability, requireManagerCtx } from '@/shared/org/membership'
import { getOrg } from '@/shared/org/org'
import { assertCustomerIdNotBlocked } from '@/shared/privacy/assert-customer-not-blocked'
import { eraseCustomerCascadeInOrg } from '@/shared/privacy/erase-customer-cascade'
import { emitClientFunnelEvent } from '@/shared/product'
import { resolveBaseUrl } from '@/shared/site-url'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

export type CustomerMutationResult = { ok: true } | { ok: false; error: string }

export type GenerateClientInviteResult =
  | { ok: true; whatsappHref: string; inviteUrl: string }
  | { ok: false; error: string }

// Contextual client invite (brief 0077, Grupo B — AC-05/AC-06, #1279). The
// recepcionista informs ONLY the WhatsApp number; the system generates a signup
// link carrying the org context + attribution and returns the `wa.me` deep link
// for her to send. NO Customer with her-typed PII is created — the customer
// materializes their own account on the other side (login → complete). The only
// datum the recep provides is the destination number, which never persists here.
export async function generateClientInvite(
  formData: FormData,
): Promise<GenerateClientInviteResult> {
  const r = await guardCapability('canManageCustomers')
  if (!r.ok) return r

  const rawPhone = formString(formData, 'whatsapp').trim()
  if (rawPhone.length === 0) return { ok: false, error: 'Informe o WhatsApp do cliente' }

  const orgId = r.ctx.membership.orgId
  const org = await getOrg(orgId)
  if (!org) return { ok: false, error: 'Estabelecimento não encontrado' }

  const baseUrl = await resolveBaseUrl()
  const built = buildClientInviteWhatsapp({
    rawPhone,
    baseUrl,
    orgName: org.name,
    invite: {
      orgSlug: org.slug,
      intent: 'signup',
      attribution: {
        source: 'whatsapp',
        medium: 'invite',
        campaign: null,
        content: null,
        term: null,
        actorId: r.ctx.session.uid,
        intent: 'signup',
      },
    },
  })
  if (!built.ok) return { ok: false, error: 'Número de WhatsApp inválido' }

  // Funnel event (AC-12) — PII-zero: org/actor ids + channel only, never the
  // number the recep typed. Best-effort; never traps the invite generation.
  await emitClientFunnelEvent({
    event: 'client_invite_issued',
    orgId,
    actorId: r.ctx.session.uid,
    intent: 'signup',
    source: 'whatsapp',
    medium: 'invite',
  })

  return { ok: true, whatsappHref: built.href, inviteUrl: built.url }
}

// NOTE(#1279): `createCustomer` was removed. The establishment no longer registers
// customers by typing PII — the "novo cliente" surface became the contextual
// invite (`generateClientInvite` above). The customer materializes their own
// account via login → completar cadastro (#1278). This is what kills the
// wrong-number ghost the brief targets. Editing an existing customer's PII
// (`updateCustomer`) stays — valid while the User is an unclaimed stub.

export async function updateCustomer(
  customerId: string,
  formData: FormData,
): Promise<CustomerMutationResult> {
  // Same balcão wall as create (brief 0075).
  const r = await guardCapability('canManageCustomers')
  if (!r.ok) return r
  const parsed = parseCustomerForm(formData)
  if (typeof parsed === 'string') return { ok: false, error: parsed }

  const orgId = r.ctx.membership.orgId

  // Write-guard (brief 0032, AC-11): a blocked customer's relationship is
  // severed — editing them in this org is rejected (erro à mostra).
  try {
    await assertCustomerIdNotBlocked(orgId, customerId)
  } catch (e) {
    if (e instanceof AuthzError) {
      return { ok: false, error: 'Cliente bloqueado neste estabelecimento (exclusão LGPD).' }
    }
    throw e
  }

  // Customer identity is PII on the User; the Customer shadow carries no
  // operator-editable free-text fields (brief 0040 — notes/tags removed).
  const piiResult = await updateCustomerPii(customerId, orgId, {
    name: parsed.name,
    whatsappRaw: parsed.whatsapp,
    email: parsed.email,
    birthDate: parsed.birthDate,
  })
  if (!piiResult.ok) return piiResult

  revalidatePath('/customers')
  redirect('/customers')
}

// Powers the delete-confirm dialog's loss-list (brief 0033, AC-07/AC-10): the
// client fetches this when the dialog opens to show what will be cancelled.
// Read-only; manager-gated like the delete itself.
export async function getCustomerDeletionImpactAction(
  customerId: string,
): Promise<CustomerDeletionImpact | { error: string }> {
  const r = await requireManagerCtx()
  if (!r.ok) return { error: r.error }
  if (!customerId) return { error: 'Cliente inválido' }
  return getCustomerDeletionImpact(r.ctx.membership.orgId, customerId)
}

export async function deleteCustomer(customerId: string): Promise<CustomerMutationResult> {
  const r = await requireManagerCtx()
  if (!r.ok) return r
  if (!customerId) return { ok: false, error: 'Cliente inválido' }
  const orgId = r.ctx.membership.orgId

  // Operator "Excluir cliente" (brief 0033, AC-07) — operational cleanup, NOT
  // the LGPD erasure (brief 0032 — subject-only, self-service, neutral label).
  // Here the NAME is preserved in history (identifiable). See the canonical map
  // Ciclo de Vida e Exclusão. The global User stays put (other orgs/self-user
  // may reference it); orphan-User cleanup is a future garbage-collect path.
  // Only `userId` is needed here (to drive the cascade); the full identity lives
  // on the global User doc. `null` means the shadow doesn't exist (404).
  const userId = await getCustomerUserId(orgId, customerId)
  if (userId === null) return { ok: false, error: 'Cliente não encontrado' }

  const impact = await getCustomerDeletionImpact(orgId, customerId)

  // The ONLY hard blocker: an open comanda is a fiscal document in progress and
  // can't be orphaned by removing the customer (same rule as the LGPD block
  // AC-11e + memberOperation offboarding 0041). The dialog already surfaced it.
  if (impact.openComandas > 0) {
    return {
      ok: false,
      error: 'Cliente com comanda aberta. Feche ou cancele a comanda antes de excluir.',
    }
  }

  // No footprint (never transacted) → hard-delete the shadow: nothing references
  // the customer, so no history is orphaned. Event-first (`deleted` doesn't
  // reproject), then drop the read model.
  if (!impact.hasFootprint) {
    const deleted = await emitEvent(
      CustomerConfig,
      aggregateRef(CustomerConfig, orgId, customerId),
      {
        _tag: 'customer.deleted',
        actorId: r.ctx.session.uid,
        payload: {},
      },
    )
    if (!deleted.ok) return { ok: false, error: deleted.error }
    // The `*.deleted` event skips reprojection; hard-delete the read-model row.
    // `hasFootprint` already routes transacted customers to the soft-archive
    // cascade below, but a cross-aggregate `ON DELETE RESTRICT` FK (brief 0068
    // D2 — orders/charges/subscriptions/appointments) is the DB's last-line
    // guard: convert its 23503 into a friendly result instead of a raw 500.
    try {
      await deleteOrgProjectionDoc(aggregateRef(CustomerConfig, orgId, customerId))
    } catch (err) {
      if (isForeignKeyViolation(err)) {
        return {
          ok: false,
          error:
            'Não é possível excluir este cliente: há registros vinculados a ele (vendas, cobranças, assinaturas ou agendamentos).',
        }
      }
      throw err
    }
    revalidatePath('/customers')
    return { ok: true }
  }

  // Has footprint → cascade-cancel the forward effects (active subscription +
  // pending charges + future appointments) with the OPERATOR as the actor (NOT
  // an LGPD erasure), then SOFT-archive via `deactivatedAt`: the customer drops
  // out of active lists/pickers but the NAME stays resolvable in history (the
  // closed orders that reference it keep showing who bought). Cascade is a saga
  // — errors surface (never a silent partial removal).
  await eraseCustomerCascadeInOrg(orgId, userId, r.ctx.session.uid)

  const now = new Date().toISOString()
  const archived = await emitEvent(
    CustomerConfig,
    aggregateRef(CustomerConfig, orgId, customerId),
    {
      _tag: 'customer.updated',
      actorId: r.ctx.session.uid,
      payload: { changes: { deactivatedAt: now } },
    },
  )
  if (!archived.ok) return { ok: false, error: archived.error }
  revalidatePath('/customers')
  return { ok: true }
}
