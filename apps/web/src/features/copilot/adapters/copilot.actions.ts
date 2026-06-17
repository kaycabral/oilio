'use server'

import { GOAL_TARGET_MIN_CENTS, goalDocId, isValidGoalPeriod, type Goal } from '@/domain'
import { GoalConfig } from '@/domain/aggregates'
import { emitEvent } from '@/shared/effect-bridge'
import { formString } from '@/shared/form-data'
import { requireManagerCtx } from '@/shared/tenant/membership'
import { revalidatePath } from 'next/cache'

export type GoalMutationResult = { ok: true } | { ok: false; error: string }

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

// Define a profit goal for a unit/period. Event-first (goal.defined carries the
// full snapshot); the deterministic doc id keeps it unique per (unit, period).
export async function defineGoal(formData: FormData): Promise<GoalMutationResult> {
  const r = await requireManagerCtx()
  if (!r.ok) return r
  const parsed = parseGoalForm(formData)
  if (typeof parsed === 'string') return { ok: false, error: parsed }

  const tenantId = r.ctx.membership.tenantId
  const id = goalDocId('profit', parsed.unitId, parsed.period)
  const now = new Date().toISOString()
  const goal: Goal = {
    id,
    tenantId,
    unitId: parsed.unitId,
    period: parsed.period,
    type: 'profit',
    targetCents: parsed.targetCents,
    createdAt: now,
    updatedAt: now,
  }

  const created = await emitEvent(GoalConfig, `tenants/${tenantId}/goals/${id}`, {
    _tag: 'goal.defined',
    actorId: r.ctx.session.uid,
    payload: { data: goal },
  })
  if (!created.ok) return created

  revalidatePath('/copilot')
  return { ok: true }
}

// Edit an existing goal's target. Only the target is mutable in Onda 1
// (unit/period identify the doc); the recalculation of realizado/ritmo/projeção
// is derived live by the read-model, so no extra write is needed.
export async function updateGoal(goalId: string, formData: FormData): Promise<GoalMutationResult> {
  const r = await requireManagerCtx()
  if (!r.ok) return r
  const parsed = parseGoalForm(formData)
  if (typeof parsed === 'string') return { ok: false, error: parsed }

  const tenantId = r.ctx.membership.tenantId
  const updated = await emitEvent(GoalConfig, `tenants/${tenantId}/goals/${goalId}`, {
    _tag: 'goal.updated',
    actorId: r.ctx.session.uid,
    payload: { changes: { targetCents: parsed.targetCents } },
  })
  if (!updated.ok) return updated

  revalidatePath('/copilot')
  return { ok: true }
}
