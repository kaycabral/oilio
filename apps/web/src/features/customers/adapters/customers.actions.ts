'use server'

import { CustomerConfig } from '@/domain/aggregates'
import { parseCustomerForm } from '@/features/customers/core/customer-form'
import { dispatchNotificationReactions } from '@/features/notifications/adapters/reactor-dispatch'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import { emitEvent } from '@/shared/effect-bridge'
import { updateCustomerPii, upsertCustomerWithUser } from '@/shared/org/customer-upsert'
import { getCustomerDeletionImpact, type CustomerDeletionImpact } from '@/shared/org/delete-guard'
import { AuthzError, requireManagerCtx, requireOrgCtx } from '@/shared/org/membership'
import { assertCustomerIdNotBlocked } from '@/shared/privacy/assert-customer-not-blocked'
import { eraseCustomerCascadeInOrg } from '@/shared/privacy/erase-customer-cascade'
import { Schema } from 'effect'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

export type CustomerMutationResult = { ok: true } | { ok: false; error: string }

// Minimal projection of the customer shadow — only `userId` is read here (to
// drive the LGPD cascade); the full identity lives on the global User doc.
const CustomerUserIdProjection = Schema.Struct({
  userId: Schema.optional(Schema.String),
})

export async function createCustomer(formData: FormData): Promise<CustomerMutationResult> {
  const r = await requireOrgCtx()
  if (!r.ok) return r
  const parsed = parseCustomerForm(formData)
  if (typeof parsed === 'string') return { ok: false, error: parsed }

  const result = await upsertCustomerWithUser({
    orgId: r.ctx.membership.orgId,
    name: parsed.name,
    whatsappRaw: parsed.whatsapp,
    email: parsed.email,
    birthDate: parsed.birthDate,
  })
  if (!result.ok) return result
  // `upsertCustomerWithUser` já emite `customer.created` (event-first
  // centralizado). PII vai pro User dentro do helper, não pro evento.

  await dispatchNotificationReactions('customer.created', r.ctx.session.uid, {
    orgId: r.ctx.membership.orgId,
    name: parsed.name,
    whatsapp: parsed.whatsapp,
  })
  revalidatePath('/customers')
  redirect('/customers')
}

export async function updateCustomer(
  customerId: string,
  formData: FormData,
): Promise<CustomerMutationResult> {
  const r = await requireOrgCtx()
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
  const customerRef = getAdminFirestore()
    .collection('orgs')
    .doc(orgId)
    .collection('customers')
    .withConverter(fsConverter(CustomerUserIdProjection))
    .doc(customerId)
  const snap = await customerRef.get()
  const customer = snap.data()
  if (!customer) return { ok: false, error: 'Cliente não encontrado' }
  const userId = customer.userId ?? ''

  const impact = await getCustomerDeletionImpact(orgId, customerId)

  // The ONLY hard blocker: an open comanda is a fiscal document in progress and
  // can't be orphaned by removing the customer (same rule as the LGPD block
  // AC-11e + professional offboarding 0041). The dialog already surfaced it.
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
    const deleted = await emitEvent(CustomerConfig, `orgs/${orgId}/customers/${customerId}`, {
      _tag: 'customer.deleted',
      actorId: r.ctx.session.uid,
      payload: {},
    })
    if (!deleted.ok) return { ok: false, error: deleted.error }
    await customerRef.delete()
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
  const archived = await emitEvent(CustomerConfig, `orgs/${orgId}/customers/${customerId}`, {
    _tag: 'customer.updated',
    actorId: r.ctx.session.uid,
    payload: { changes: { deactivatedAt: now } },
  })
  if (!archived.ok) return { ok: false, error: archived.error }
  revalidatePath('/customers')
  return { ok: true }
}
