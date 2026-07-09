'use server'

import { Commission, liquidationStatusOf } from '@/domain'
import { CommissionConfig } from '@/domain/aggregates'
import { hasCapability } from '@/domain/billing/capabilities'
import { aggregateRef } from '@/domain/effect'
import {
  type CommissionRow,
  rowToDoc as commissionRowToDoc,
} from '@/shared/db/pg/effect/commission-projector'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { emitEvent } from '@/shared/effect-bridge'
import { getOrgTier } from '@/shared/org/billing-read'
import { requireOwnerCtx } from '@/shared/org/membership'
import { Schema } from 'effect'
import { revalidatePath } from 'next/cache'

const decodeCommission = Schema.decodeUnknownSync(Commission)

export type MarkPaidResult = { ok: true; markedCount: number } | { ok: false; error: string }

async function assertCommissionsCapability(orgId: string): Promise<MarkPaidResult | null> {
  const tier = await getOrgTier(orgId)
  if (!hasCapability(tier, 'commissions')) {
    return {
      ok: false,
      error: 'A liquidação de comissões está disponível no plano Pro. Faça upgrade para continuar.',
    }
  }
  return null
}

async function loadMemberCommissionsInWindow(
  orgId: string,
  attributedUserId: string,
  fromIso: string,
  toIso: string,
): Promise<Commission[]> {
  const rows = await readUnderRls<CommissionRow>(orgId, (client) =>
    client
      .query<CommissionRow>(
        `SELECT * FROM commissions
           WHERE org_id = $1 AND attributed_user_id = $2
             AND created_at >= $3 AND created_at <= $4`,
        [orgId, attributedUserId, fromIso, toIso],
      )
      .then((res) => res.rows),
  )
  return rows.map((r) => decodeCommission(commissionRowToDoc(r)))
}

async function getCommissionById(orgId: string, commissionId: string): Promise<Commission | null> {
  const rows = await readUnderRls<CommissionRow>(orgId, (client) =>
    client
      .query<CommissionRow>('SELECT * FROM commissions WHERE org_id = $1 AND id = $2', [
        orgId,
        commissionId,
      ])
      .then((res) => res.rows),
  )
  const row = rows[0]
  return row ? decodeCommission(commissionRowToDoc(row)) : null
}

export async function markCommissionsPaid(formData: FormData): Promise<MarkPaidResult> {
  const r = await requireOwnerCtx()
  if (!r.ok) return { ok: false, error: r.error }
  const gate = await assertCommissionsCapability(r.ctx.membership.orgId)
  if (gate) return gate

  const attributedUserId = formData.get('attributedUserId')
  if (typeof attributedUserId !== 'string' || attributedUserId.length === 0) {
    return { ok: false, error: 'Membro não informado' }
  }
  const fromIso = formData.get('fromIso')
  const toIso = formData.get('toIso')
  if (typeof fromIso !== 'string' || typeof toIso !== 'string' || !fromIso || !toIso) {
    return { ok: false, error: 'Período não informado' }
  }

  const proofRaw = formData.get('paymentProof')
  const paymentProof = typeof proofRaw === 'string' && proofRaw.trim() ? proofRaw.trim() : null
  const paidAt = new Date().toISOString()

  const commissions = await loadMemberCommissionsInWindow(
    r.ctx.membership.orgId,
    attributedUserId,
    fromIso,
    toIso,
  )

  const pending = commissions.filter((c) => liquidationStatusOf(c) === 'pendente')
  if (pending.length === 0) {
    return { ok: false, error: 'Nenhuma comissão pendente no período para este membro' }
  }

  let markedCount = 0
  for (const commission of pending) {
    const updated = await emitEvent(
      CommissionConfig,
      aggregateRef(CommissionConfig, r.ctx.membership.orgId, commission.id),
      {
        _tag: 'commission.updated',
        actorId: r.ctx.session.uid,
        payload: { changes: { liquidationStatus: 'pago', paidAt, paymentProof } },
      },
    )
    if (!updated.ok) return { ok: false, error: updated.error }
    markedCount += 1
  }

  revalidatePath('/reports')
  return { ok: true, markedCount }
}

export async function markCommissionPaid(formData: FormData): Promise<MarkPaidResult> {
  const r = await requireOwnerCtx()
  if (!r.ok) return { ok: false, error: r.error }
  const gate = await assertCommissionsCapability(r.ctx.membership.orgId)
  if (gate) return gate

  const commissionId = formData.get('commissionId')
  if (typeof commissionId !== 'string' || commissionId.length === 0) {
    return { ok: false, error: 'Comissão não informada' }
  }

  const proofRaw = formData.get('paymentProof')
  const paymentProof = typeof proofRaw === 'string' && proofRaw.trim() ? proofRaw.trim() : null

  const commission = await getCommissionById(r.ctx.membership.orgId, commissionId)
  if (!commission) return { ok: false, error: 'Comissão não encontrada' }

  if (liquidationStatusOf(commission) === 'pago') {
    return { ok: false, error: 'Comissão já paga é imutável' }
  }

  const updated = await emitEvent(
    CommissionConfig,
    aggregateRef(CommissionConfig, r.ctx.membership.orgId, commissionId),
    {
      _tag: 'commission.updated',
      actorId: r.ctx.session.uid,
      payload: {
        changes: { liquidationStatus: 'pago', paidAt: new Date().toISOString(), paymentProof },
      },
    },
  )
  if (!updated.ok) return { ok: false, error: updated.error }

  revalidatePath('/reports')
  return { ok: true, markedCount: 1 }
}

export type MarkPaidFormState = { ok: boolean; error?: string; markedCount?: number }

export async function markCommissionsPaidFormAction(
  _prev: MarkPaidFormState,
  formData: FormData,
): Promise<MarkPaidFormState> {
  const res = await markCommissionsPaid(formData)
  return res.ok ? { ok: true, markedCount: res.markedCount } : { ok: false, error: res.error }
}
