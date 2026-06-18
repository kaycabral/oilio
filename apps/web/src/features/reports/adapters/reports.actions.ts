'use server'

import { Commission, liquidationStatusOf } from '@/domain'
import { CommissionConfig } from '@/domain/aggregates'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import { emitEvent } from '@/shared/effect-bridge'
import { requireOwnerCtx } from '@/shared/org/membership'
import { revalidatePath } from 'next/cache'

export type MarkPaidResult = { ok: true; markedCount: number } | { ok: false; error: string }

// AC-03 (brief 0022 #999): o owner marca uma comissão — ou um lote por
// membro/período — como `pago`. Cada comissão pendente emite `commission.updated`
// carregando `liquidationStatus: pago` + `paidAt` + `paymentProof` opcional
// (event-first, sem write direto). Comissões já `pago` são imutáveis: ficam de
// fora do lote silenciosamente (idempotência) e uma marcação explícita de uma
// comissão paga é rejeitada com erro à mostra.
//
// O batch é a gestão canônica do owner ("marcar pago por membro/período"): paga
// tudo o que está pendente no recorte, num gesto só. A chave do lote é o membro
// (`attributedUserId`, brief 0030 AC-07) — qualquer papel, não só Professional.
export async function markCommissionsPaid(formData: FormData): Promise<MarkPaidResult> {
  const r = await requireOwnerCtx()
  if (!r.ok) return { ok: false, error: r.error }

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

  const orgRef = getAdminFirestore().collection('orgs').doc(r.ctx.membership.orgId)
  const snap = await orgRef
    .collection('commissions')
    .withConverter(fsConverter(Commission))
    .where('attributedUserId', '==', attributedUserId)
    .where('createdAt', '>=', fromIso)
    .where('createdAt', '<=', toIso)
    .get()

  // Só as pendentes entram no lote — uma comissão já paga é imutável e fica
  // intocada (idempotência: re-rodar o lote não duplica nem reverte pagamentos).
  const pending = snap.docs.filter((d) => liquidationStatusOf(d.data()) === 'pendente')
  if (pending.length === 0) {
    return { ok: false, error: 'Nenhuma comissão pendente no período para este membro' }
  }

  let markedCount = 0
  for (const doc of pending) {
    const updated = await emitEvent(
      CommissionConfig,
      `orgs/${r.ctx.membership.orgId}/commissions/${doc.id}`,
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

// Marca UMA comissão específica como paga (AC-03 — caso unitário). Guarda de
// imutabilidade explícita: rejeita se já estiver `pago` (não silenciosa, ao
// contrário do batch que só pula). Mesmo evento `commission.updated`.
export async function markCommissionPaid(formData: FormData): Promise<MarkPaidResult> {
  const r = await requireOwnerCtx()
  if (!r.ok) return { ok: false, error: r.error }

  const commissionId = formData.get('commissionId')
  if (typeof commissionId !== 'string' || commissionId.length === 0) {
    return { ok: false, error: 'Comissão não informada' }
  }

  const proofRaw = formData.get('paymentProof')
  const paymentProof = typeof proofRaw === 'string' && proofRaw.trim() ? proofRaw.trim() : null

  const orgRef = getAdminFirestore().collection('orgs').doc(r.ctx.membership.orgId)
  const ref = orgRef
    .collection('commissions')
    .withConverter(fsConverter(Commission))
    .doc(commissionId)
  const doc = await ref.get()
  const commission = doc.data()
  if (!commission) return { ok: false, error: 'Comissão não encontrada' }

  // Imutabilidade após pago (AC-03): uma comissão paga não pode ser re-marcada
  // nem editada — a tentativa volta como erro à mostra.
  if (liquidationStatusOf(commission) === 'pago') {
    return { ok: false, error: 'Comissão já paga é imutável' }
  }

  const updated = await emitEvent(
    CommissionConfig,
    `orgs/${r.ctx.membership.orgId}/commissions/${commissionId}`,
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

// useActionState wrapper (Pattern B) — o relatório dispara o lote via
// `<form action>` e renderiza o resultado/erro inline sem navegar.
export type MarkPaidFormState = { ok: boolean; error?: string; markedCount?: number }

export async function markCommissionsPaidFormAction(
  _prev: MarkPaidFormState,
  formData: FormData,
): Promise<MarkPaidFormState> {
  const res = await markCommissionsPaid(formData)
  return res.ok ? { ok: true, markedCount: res.markedCount } : { ok: false, error: res.error }
}
