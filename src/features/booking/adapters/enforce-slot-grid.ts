import type { Unit } from '@/domain'
import { isStartAtOnGrid, unitBusinessHours, unitSlotMinutes } from '@/domain'
import { track } from '@/shared/lib/track'
import 'server-only'

type GridUnit = Pick<Unit, 'id' | 'timezone' | 'agenda'>

export type SlotGridOk = { ok: true }
export type SlotGridBlocked = { ok: false; error: string }
export type SlotGridResult = SlotGridOk | SlotGridBlocked

const OFF_GRID_MESSAGE =
  'Horário fora da grade de atendimento da unidade. Escolha um horário disponível na agenda.'

export function enforceSlotGrid(args: {
  unit: GridUnit
  startAt: string
  durationMinutes: number
  surface: 'self_book' | 'reception'
  orgId: string
  userId: string
  nowMs?: number
}): SlotGridResult {
  if (args.unit.agenda.mode !== 'appointment') return { ok: true }

  const onGrid = isStartAtOnGrid({
    startAt: args.startAt,
    slotMinutes: unitSlotMinutes(args.unit.agenda),
    durationMinutes: args.durationMinutes,
    businessHours: unitBusinessHours(args.unit.agenda),
    timezone: args.unit.timezone,
    nowMs: args.nowMs ?? Date.now(),
  })
  if (onGrid) return { ok: true }

  track('appointment_write_rejected_offgrid', {
    org_id: args.orgId,
    user_id: args.userId,
    unit_id: args.unit.id,
    surface: args.surface,
    reason: 'off_grid',
  })
  return { ok: false, error: OFF_GRID_MESSAGE }
}
