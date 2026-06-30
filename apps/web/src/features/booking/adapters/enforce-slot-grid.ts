import type { Unit } from '@/domain'
import { isStartAtOnGrid, unitBusinessHours, unitSlotMinutes } from '@/domain'
import { track } from '@/shared/lib/track'
import 'server-only'

// Only the agenda config + tz + id drive the grid check — never PII. Accepts
// both the PII-hydrated `Unit` and the stored projection (`StoredUnit`).
type GridUnit = Pick<Unit, 'id' | 'timezone' | 'agenda'>

export type SlotGridOk = { ok: true }
export type SlotGridBlocked = { ok: false; error: string }
export type SlotGridResult = SlotGridOk | SlotGridBlocked

const OFF_GRID_MESSAGE =
  'Horário fora da grade de atendimento da unidade. Escolha um horário disponível na agenda.'

// Server-side slot-grid invariant (brief 0080, Grupo A): a booking write is
// rejected unless its `startAt` lands on a configured slot of the unit's grid,
// inside business hours. Authoritative regardless of the client — a forged
// request that skips the UI is barred here. Shared by the three write surfaces
// (self-book, reception create, reception edit); brief 0080 § B folds it into
// the single validation layer.
//
// Emits `appointment_write_rejected_offgrid` on rejection (brief 0080 §
// metrics) so the primary metric — % of off-grid writes rejected — is
// observable in runtime.
export function enforceSlotGrid(args: {
  unit: GridUnit
  startAt: string
  surface: 'self_book' | 'reception'
  orgId: string
  // Acting user — the operator for reception, the customer for self-book.
  userId: string
}): SlotGridResult {
  // The slot grid is an appointment-mode concept: `slotMinutes` + business hours
  // only exist there. `always_open`/`fixed` units have no bookable grid to align
  // to — the write path still enforces overlap, but never slot-grid. No-op here.
  if (args.unit.agenda.mode !== 'appointment') return { ok: true }

  const onGrid = isStartAtOnGrid({
    startAt: args.startAt,
    slotMinutes: unitSlotMinutes(args.unit.agenda),
    businessHours: unitBusinessHours(args.unit.agenda),
    timezone: args.unit.timezone,
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
