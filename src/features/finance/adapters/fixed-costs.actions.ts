'use server'

import {
  DEFAULT_UNIT_TIMEZONE,
  FIXED_COST_NAME_MAX,
  FIXED_COST_NAME_MIN,
  isFixedCostCategory,
  type FixedCost,
  type FixedCostOverride,
} from '@/domain'
import { FixedCostConfig, FixedCostOverrideConfig } from '@/domain/aggregates'
import {
  aggregateRef,
  appendEventToTx,
  type SagaStep,
  type TransactionContext,
} from '@/domain/effect'
import { firstInstantOfMonthUtc, toOrgMonth } from '@/domain/utils/competence-month'
import {
  getFixedCostById,
  getFixedCostOverride,
} from '@/features/finance/adapters/fixed-costs.repo'
import {
  parseEffectiveFromMonth,
  parseFixedCostForm,
} from '@/features/finance/core/fixed-cost-form'
import { newId } from '@/shared/db/pg/new-id'
import { commitSaga, emitEvent } from '@/shared/effect-bridge'
import { formString } from '@/shared/form-data'
import { requireManagerCtx, requireOwnerCtx } from '@/shared/org/membership'
import { getUnitTimezone } from '@/shared/org/unit-read'
import { parseSignedBRLInput } from '@cbrl/br/money'
import { revalidatePath } from 'next/cache'

export type FixedCostMutationResult = { ok: true } | { ok: false; error: string }

const UNIT_FIELD = 'unitId'

export async function createFixedCost(formData: FormData): Promise<FixedCostMutationResult> {
  const r = await requireManagerCtx()
  if (!r.ok) return r
  const orgId = r.ctx.membership.orgId
  const unitId = formString(formData, UNIT_FIELD).trim()
  if (unitId === '') return { ok: false, error: 'Unidade é obrigatória' }

  const parsed = parseFixedCostForm(formData)
  if (typeof parsed === 'string') return { ok: false, error: parsed }

  const tz = (await getUnitTimezone(orgId, unitId)) ?? DEFAULT_UNIT_TIMEZONE
  const id = newId()
  const now = new Date().toISOString()
  const cost: FixedCost = {
    id,
    orgId,
    unitId,
    seriesId: id,
    name: parsed.name,
    category: parsed.category,
    amountCents: parsed.amountCents,
    effectiveFrom: firstInstantOfMonthUtc(parsed.effectiveFromMonth, tz),
    effectiveTo: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  }
  const created = await emitEvent(
    FixedCostConfig,
    aggregateRef(FixedCostConfig, orgId, id),
    { _tag: 'fixed_cost.created', actorId: r.ctx.session.uid, payload: { data: cost } },
    { orgId, unitId },
  )
  if (!created.ok) return { ok: false, error: created.error }
  revalidatePath('/finance')
  return { ok: true }
}

export async function updateFixedCostValue(
  fixedCostId: string,
  formData: FormData,
): Promise<FixedCostMutationResult> {
  const r = await requireManagerCtx()
  if (!r.ok) return r
  const orgId = r.ctx.membership.orgId

  const current = await getFixedCostById(orgId, fixedCostId)
  if (!current) return { ok: false, error: 'Custo fixo não encontrado' }
  if (current.effectiveTo !== null) {
    return { ok: false, error: 'Só a vigência corrente pode ser alterada' }
  }

  const amountCents = parseSignedBRLInput(formString(formData, 'amount'))
  if (amountCents === null || amountCents < 1) return { ok: false, error: 'Valor inválido' }

  const changeMonth = parseEffectiveFromMonth(formString(formData, 'effectiveFrom'))
  if (changeMonth === null) return { ok: false, error: 'Vigência inválida' }
  const tz = (await getUnitTimezone(orgId, current.unitId)) ?? DEFAULT_UNIT_TIMEZONE
  const changeAt = firstInstantOfMonthUtc(changeMonth, tz)
  if (changeMonth <= toOrgMonth(current.effectiveFrom, tz)) {
    return { ok: false, error: 'A nova vigência deve começar depois da atual' }
  }

  const now = new Date().toISOString()
  const nextId = newId()
  const next: FixedCost = {
    ...current,
    id: nextId,
    amountCents: amountCents,
    effectiveFrom: changeAt,
    effectiveTo: null,
    createdAt: now,
    updatedAt: now,
  }

  const steps: SagaStep[] = [
    (tx: TransactionContext) =>
      appendEventToTx(
        FixedCostConfig,
        aggregateRef(FixedCostConfig, orgId, current.id),
        {
          _tag: 'fixed_cost.superseded',
          actorId: r.ctx.session.uid,
          payload: { effectiveTo: changeAt },
        },
        tx,
      ),
    (tx: TransactionContext) =>
      appendEventToTx(
        FixedCostConfig,
        aggregateRef(FixedCostConfig, orgId, nextId),
        { _tag: 'fixed_cost.created', actorId: r.ctx.session.uid, payload: { data: next } },
        tx,
      ),
  ]

  const res = await commitSaga(steps, { orgId, unitId: current.unitId })
  if (!res.ok) return { ok: false, error: res.error }
  revalidatePath('/finance')
  return { ok: true }
}

export async function updateFixedCostMeta(
  fixedCostId: string,
  formData: FormData,
): Promise<FixedCostMutationResult> {
  const r = await requireManagerCtx()
  if (!r.ok) return r
  const orgId = r.ctx.membership.orgId

  const current = await getFixedCostById(orgId, fixedCostId)
  if (!current) return { ok: false, error: 'Custo fixo não encontrado' }

  const changes: Partial<FixedCost> = {}
  const name = formString(formData, 'name').trim()
  if (name !== '') {
    if (name.length < FIXED_COST_NAME_MIN) return { ok: false, error: 'Nome é obrigatório' }
    if (name.length > FIXED_COST_NAME_MAX) {
      return { ok: false, error: `Nome muito longo (máx. ${FIXED_COST_NAME_MAX})` }
    }
    changes.name = name
  }
  const category = formString(formData, 'category').trim()
  if (category !== '') {
    if (!isFixedCostCategory(category)) return { ok: false, error: 'Categoria inválida' }
    changes.category = category
  }
  if (Object.keys(changes).length === 0) return { ok: true }

  const updated = await emitEvent(
    FixedCostConfig,
    aggregateRef(FixedCostConfig, orgId, fixedCostId),
    { _tag: 'fixed_cost.updated', actorId: r.ctx.session.uid, payload: { changes } },
    { orgId, unitId: current.unitId },
  )
  if (!updated.ok) return { ok: false, error: updated.error }
  revalidatePath('/finance')
  return { ok: true }
}

export async function archiveFixedCost(
  fixedCostId: string,
  archived = true,
): Promise<FixedCostMutationResult> {
  const r = await requireOwnerCtx()
  if (!r.ok) return r
  const orgId = r.ctx.membership.orgId
  const current = await getFixedCostById(orgId, fixedCostId)
  if (!current) return { ok: false, error: 'Custo fixo não encontrado' }

  const archivedAt = archived ? new Date().toISOString() : null
  const res = await emitEvent(
    FixedCostConfig,
    aggregateRef(FixedCostConfig, orgId, fixedCostId),
    { _tag: 'fixed_cost.archived', actorId: r.ctx.session.uid, payload: { archivedAt } },
    { orgId, unitId: current.unitId },
  )
  if (!res.ok) return { ok: false, error: res.error }
  revalidatePath('/finance')
  return { ok: true }
}

export async function setFixedCostOverride(
  fixedCostId: string,
  month: string,
  formData: FormData,
): Promise<FixedCostMutationResult> {
  const r = await requireManagerCtx()
  if (!r.ok) return r
  const orgId = r.ctx.membership.orgId
  if (!/^\d{4}-\d{2}$/.test(month)) return { ok: false, error: 'Mês inválido' }

  const current = await getFixedCostById(orgId, fixedCostId)
  if (!current) return { ok: false, error: 'Custo fixo não encontrado' }

  const amountCents = parseSignedBRLInput(formString(formData, 'amount'))
  if (amountCents === null || amountCents < 1) return { ok: false, error: 'Valor inválido' }

  const existing = await getFixedCostOverride(orgId, current.seriesId, month)
  const now = new Date().toISOString()
  if (existing) {
    const updated = await emitEvent(
      FixedCostOverrideConfig,
      aggregateRef(FixedCostOverrideConfig, orgId, existing.id),
      {
        _tag: 'fixed_cost_override.updated',
        actorId: r.ctx.session.uid,
        payload: { changes: { amountCents } },
      },
      { orgId, unitId: current.unitId },
    )
    if (!updated.ok) return { ok: false, error: updated.error }
    revalidatePath('/finance')
    return { ok: true }
  }

  const id = newId()
  const override: FixedCostOverride = {
    id,
    orgId,
    unitId: current.unitId,
    seriesId: current.seriesId,
    month,
    amountCents: amountCents,
    createdAt: now,
    updatedAt: now,
  }
  const created = await emitEvent(
    FixedCostOverrideConfig,
    aggregateRef(FixedCostOverrideConfig, orgId, id),
    { _tag: 'fixed_cost_override.set', actorId: r.ctx.session.uid, payload: { data: override } },
    { orgId, unitId: current.unitId },
  )
  if (!created.ok) return { ok: false, error: created.error }
  revalidatePath('/finance')
  return { ok: true }
}
