'use server'

import { isUnitPubliclyLive } from '@/domain'
import { CustomerConfig } from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import { deleteOrgProjectionDoc } from '@/shared/db/effect/delete-projection'
import { isForeignKeyViolation } from '@/shared/db/pg/fk-violation'
import { emitEvent } from '@/shared/effect-bridge'
import { classifyError } from '@/shared/errors/classify'
import { messageForCategory } from '@/shared/errors/messages'
import { getCustomerUserId } from '@/shared/org/customer-read'
import { getCustomerDeletionImpact, type CustomerDeletionImpact } from '@/shared/org/delete-guard'
import { guardCapability, requireManagerCtx } from '@/shared/org/membership'
import { listUnitsForOrg } from '@/shared/org/unit-read'
import { eraseCustomerCascadeInOrg } from '@/shared/privacy/erase-customer-cascade'
import { emitClientFunnelEvent } from '@/shared/product'
import { revalidatePath } from 'next/cache'

export type CustomerMutationResult = { ok: true } | { ok: false; error: string }

export type RecordClientInviteResult = { ok: true } | { ok: false; error: string }

// Contextual client invite — funnel telemetry side (brief 0077, Grupo B —
// AC-06/AC-12, #1279). The actual link is built CLIENT-SIDE (pure core
// `buildClientInviteWhatsapp`, reactive to the typed number) so the recep sees it
// the moment the number is valid. This action only records the PII-zero funnel
// event when she actually sends it ("Abrir no WhatsApp"), re-checking the
// capability + that the target unit is publicly bookable (the server wall — the
// client gate is just UX). NO Customer with recep-typed PII is created.
export async function recordClientInviteIssued(input: {
  unitSlug: string
}): Promise<RecordClientInviteResult> {
  const r = await guardCapability('canManageCustomers')
  if (!r.ok) return r

  const orgId = r.ctx.membership.orgId
  const unitSlug = input.unitSlug.trim()
  if (unitSlug.length === 0) return { ok: false, error: 'Selecione a unidade do convite' }

  // The invite must target a unit whose public booking is live, else the link
  // dead-ends on "indisponível". Same gate the dialog checks client-side, and the
  // same inferred-availability rule the public landing/slots use (no stored
  // publish flag — PRD Identidade v2 / SPIKE): appointment mode + complete
  // address & hours.
  const units = await listUnitsForOrg(orgId)
  const unit = units.find((u) => u.slug === unitSlug)
  if (!unit) return { ok: false, error: 'Unidade não encontrada' }
  if (!isUnitPubliclyLive(unit)) {
    return { ok: false, error: 'Essa unidade ainda não está com agendamento público ativo' }
  }

  // Funnel event (AC-12) — PII-zero: org/actor/unit ids + channel only, never the
  // number the recep typed. Best-effort; never traps the invite send.
  await emitClientFunnelEvent({
    event: 'client_invite_issued',
    orgId,
    unitId: unit.id,
    actorId: r.ctx.session.uid,
    intent: 'signup',
    source: 'whatsapp',
    medium: 'invite',
  })

  return { ok: true }
}

// NOTE(#1279): `createCustomer` was removed. The establishment no longer registers
// customers by typing PII — the "novo cliente" surface became the contextual
// invite (`generateClientInvite` above). The customer materializes their own
// account via login → completar cadastro (#1278). This is what kills the
// wrong-number ghost the brief targets. Editing an existing customer's PII
// the customer's own data (#1278). The establishment only consults the customer
// (read-only detail), so there is no establishment-side edit action anymore.

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
      // A non-FK defect (CHECK/RLS/unknown) would otherwise escape as a raw
      // 500; map it to the canonical generic message (detail stays in the log).
      return { ok: false as const, error: messageForCategory(classifyError(err)) }
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
