'use server'

import {
  type AgendaBlock,
  type AgendaBlockKind,
  type Weekday,
  AGENDA_BLOCK_KINDS,
  WEEKDAYS,
  fromOrgTime,
  validateHoursRange,
} from '@/domain'
import { AgendaBlockConfig } from '@/domain/aggregates'
import { getAdminFirestore } from '@/shared/db'
import { emitEvent } from '@/shared/effect-bridge'
import { formString } from '@/shared/form-data'
import { requireManagerCtx } from '@/shared/org/membership'
import { getOrg } from '@/shared/org/org'
import { revalidatePath } from 'next/cache'

// Agenda-block mutations, shared by the contexts that own the time being
// blocked (brief 0036): the unit config (`units/[id]`, unit-wide blocks) and
// the professional member detail (`/team/[userId]`, per-professional blocks).
// `/blocks` was removed — these actions no longer redirect to it; the calling
// section refreshes in place (`router.refresh()`), and the agenda is
// revalidated so the segments reflect the change.

export type BlockMutationResult = { ok: true } | { ok: false; error: string }

function isWeekday(v: string): v is Weekday {
  return (WEEKDAYS as readonly string[]).includes(v)
}

function isAgendaBlockKind(v: string): v is AgendaBlockKind {
  return (AGENDA_BLOCK_KINDS as readonly string[]).includes(v)
}

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never
type ParsedBlock = DistributiveOmit<AgendaBlock, 'id' | 'orgId' | 'createdAt' | 'updatedAt'>

function parseBlockForm(formData: FormData, orgTimezone: string): ParsedBlock | string {
  const kindRaw = formString(formData, 'kind')
  if (!isAgendaBlockKind(kindRaw)) return 'Tipo inválido'
  const unitId = formString(formData, 'unitId').trim()
  if (!unitId) return 'Unidade é obrigatória'
  const professionalIdRaw = formString(formData, 'professionalId').trim()
  const professionalId = professionalIdRaw.length > 0 ? professionalIdRaw : null
  const reason = formString(formData, 'reason').trim()
  if (reason.length < 2) return 'Motivo é obrigatório'

  if (kindRaw === 'recurring') {
    const weekdayRaw = formString(formData, 'weekday')
    if (!isWeekday(weekdayRaw)) return 'Dia da semana inválido'
    const open = formString(formData, 'open')
    const close = formString(formData, 'close')
    const err = validateHoursRange({ open, close })
    if (err) return err
    return {
      kind: 'recurring',
      unitId,
      professionalId,
      reason,
      weekday: weekdayRaw,
      open,
      close,
      startAt: null,
      endAt: null,
    }
  }

  const date = formString(formData, 'date')
  const start = formString(formData, 'start')
  const end = formString(formData, 'end')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'Data inválida'
  const rangeErr = validateHoursRange({ open: start, close: end })
  if (rangeErr) return rangeErr
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  if (sh === undefined || sm === undefined || eh === undefined || em === undefined) {
    return 'Horário inválido'
  }
  return {
    kind: 'one_off',
    unitId,
    professionalId,
    reason,
    weekday: null,
    open: null,
    close: null,
    startAt: fromOrgTime({ date, hour: sh, minute: sm }, orgTimezone),
    endAt: fromOrgTime({ date, hour: eh, minute: em }, orgTimezone),
  }
}

export async function createBlock(formData: FormData): Promise<BlockMutationResult> {
  const r = await requireManagerCtx()
  if (!r.ok) return r
  const org = await getOrg(r.ctx.membership.orgId)
  if (!org) return { ok: false, error: 'Org não encontrado' }
  const parsed = parseBlockForm(formData, org.timezone)
  if (typeof parsed === 'string') return { ok: false, error: parsed }

  const db = getAdminFirestore()
  const ref = db.collection('orgs').doc(r.ctx.membership.orgId).collection('agenda_blocks').doc()
  const now = new Date().toISOString()
  const block: AgendaBlock = {
    ...parsed,
    id: ref.id,
    orgId: r.ctx.membership.orgId,
    createdAt: now,
    updatedAt: now,
  }
  // Event-first: o doc é projeção do `agenda_block.created` (snapshot completo),
  // sem `ref.set()` direto paralelo.
  const created = await emitEvent(
    AgendaBlockConfig,
    `orgs/${r.ctx.membership.orgId}/agenda_blocks/${ref.id}`,
    { _tag: 'agenda_block.created', actorId: r.ctx.session.uid, payload: { data: block } },
  )
  if (!created.ok) return { ok: false, error: created.error }
  revalidatePath('/agenda')
  return { ok: true }
}

export async function updateBlock(
  blockId: string,
  formData: FormData,
): Promise<BlockMutationResult> {
  const r = await requireManagerCtx()
  if (!r.ok) return r
  const org = await getOrg(r.ctx.membership.orgId)
  if (!org) return { ok: false, error: 'Org não encontrado' }
  const parsed = parseBlockForm(formData, org.timezone)
  if (typeof parsed === 'string') return { ok: false, error: parsed }

  // Event-first: a projeção da edição vem do `agenda_block.updated` (sem
  // `.update()` direto). `changes` carrega o diff do form parseado.
  const updated = await emitEvent(
    AgendaBlockConfig,
    `orgs/${r.ctx.membership.orgId}/agenda_blocks/${blockId}`,
    { _tag: 'agenda_block.updated', actorId: r.ctx.session.uid, payload: { changes: parsed } },
  )
  if (!updated.ok) return { ok: false, error: updated.error }

  revalidatePath('/agenda')
  return { ok: true }
}

export async function deleteBlock(blockId: string): Promise<BlockMutationResult> {
  const r = await requireManagerCtx()
  if (!r.ok) return r
  // Event-first: emite `agenda_block.deleted` ANTES do hard-delete — o append lê
  // a versão da projeção ainda viva (versão correta); o event-store não reprojeta
  // em `.deleted`, então o caller remove o doc. Histórico fica na subcollection.
  const deleted = await emitEvent(
    AgendaBlockConfig,
    `orgs/${r.ctx.membership.orgId}/agenda_blocks/${blockId}`,
    { _tag: 'agenda_block.deleted', actorId: r.ctx.session.uid, payload: {} },
  )
  if (!deleted.ok) return { ok: false, error: deleted.error }
  await getAdminFirestore()
    .collection('orgs')
    .doc(r.ctx.membership.orgId)
    .collection('agenda_blocks')
    .doc(blockId)
    .delete()
  revalidatePath('/agenda')
  return { ok: true }
}
