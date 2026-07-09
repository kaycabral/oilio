'use server'

import { GOAL_TARGET_MIN_CENTS, goalDocId, isValidGoalPeriod, type Goal } from '@/domain'
import { GoalConfig } from '@/domain/aggregates'
import { hasCapability } from '@/domain/billing/capabilities'
import { aggregateRef } from '@/domain/effect'
import { emitEvent } from '@/shared/effect-bridge'
import { formString } from '@/shared/form-data'
import { getOrgTier } from '@/shared/org/billing-read'
import { requireManagerCtx } from '@/shared/org/membership'
import { revalidatePath } from 'next/cache'

export type GoalMutationResult = { ok: true } | { ok: false; error: string }

async function assertCopilotCapability(orgId: string): Promise<GoalMutationResult | null> {
  const tier = await getOrgTier(orgId)
  if (!hasCapability(tier, 'copilot.profit_goal')) {
    return {
      ok: false,
      error: 'O Copiloto está disponível no plano Pro. Faça upgrade para definir metas.',
    }
  }
  return null
}

type GoalFormPayload = { unitId: string; period: string; targetCents: number }

function parseGoalForm(formData: FormData): GoalFormPayload | string {
  const unitId = formString(formData, 'unitId').trim()
  if (unitId.length === 0) return 'Unidade é obrigatória'

  const period = formString(formData, 'period').trim()
  if (!isValidGoalPeriod(period)) return 'Período inválido (use AAAA-MM)'

  const raw = formString(formData, 'target').trim()
  if (raw.length === 0) return 'Informe a meta de lucro'
  const targetCents = Math.round(Number(raw.replace(',', '.')) * 100)
  if (!Number.isFinite(targetCents) || targetCents < GOAL_TARGET_MIN_CENTS) {
    return 'Informe uma meta de lucro maior que zero'
  }

  return { unitId, period, targetCents }
}

export async function defineGoal(formData: FormData): Promise<GoalMutationResult> {
  const r = await requireManagerCtx()
  if (!r.ok) return r
  const gate = await assertCopilotCapability(r.ctx.membership.orgId)
  if (gate) return gate
  const parsed = parseGoalForm(formData)
  if (typeof parsed === 'string') return { ok: false, error: parsed }

  const orgId = r.ctx.membership.orgId
  const id = goalDocId('profit', parsed.unitId, parsed.period)
  const now = new Date().toISOString()
  const goal: Goal = {
    id,
    orgId,
    unitId: parsed.unitId,
    period: parsed.period,
    type: 'profit',
    targetCents: parsed.targetCents,
    createdAt: now,
    updatedAt: now,
  }

  const created = await emitEvent(GoalConfig, aggregateRef(GoalConfig, orgId, id), {
    _tag: 'goal.defined',
    actorId: r.ctx.session.uid,
    payload: { data: goal },
  })
  if (!created.ok) return created

  revalidatePath('/copilot')
  return { ok: true }
}

export async function updateGoal(goalId: string, formData: FormData): Promise<GoalMutationResult> {
  const r = await requireManagerCtx()
  if (!r.ok) return r
  const gate = await assertCopilotCapability(r.ctx.membership.orgId)
  if (gate) return gate
  const parsed = parseGoalForm(formData)
  if (typeof parsed === 'string') return { ok: false, error: parsed }

  const orgId = r.ctx.membership.orgId
  const updated = await emitEvent(GoalConfig, aggregateRef(GoalConfig, orgId, goalId), {
    _tag: 'goal.updated',
    actorId: r.ctx.session.uid,
    payload: { changes: { targetCents: parsed.targetCents } },
  })
  if (!updated.ok) return updated

  revalidatePath('/copilot')
  return { ok: true }
}
