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

export async function recordClientInviteIssued(input: {
  unitSlug: string
}): Promise<RecordClientInviteResult> {
  const r = await guardCapability('canManageCustomers')
  if (!r.ok) return r

  const orgId = r.ctx.membership.orgId
  const unitSlug = input.unitSlug.trim()
  if (unitSlug.length === 0) return { ok: false, error: 'Selecione a unidade do convite' }

  const units = await listUnitsForOrg(orgId)
  const unit = units.find((u) => u.slug === unitSlug)
  if (!unit) return { ok: false, error: 'Unidade não encontrada' }
  if (!isUnitPubliclyLive(unit)) {
    return { ok: false, error: 'Essa unidade ainda não está com agendamento público ativo' }
  }

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

  const userId = await getCustomerUserId(orgId, customerId)
  if (userId === null) return { ok: false, error: 'Cliente não encontrado' }

  const impact = await getCustomerDeletionImpact(orgId, customerId)

  if (impact.openComandas > 0) {
    return {
      ok: false,
      error: 'Cliente com comanda aberta. Feche ou cancele a comanda antes de excluir.',
    }
  }

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
      return { ok: false as const, error: messageForCategory(classifyError(err)) }
    }
    revalidatePath('/customers')
    return { ok: true }
  }

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
