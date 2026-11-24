import type { BusinessHours } from '../types/unit'
import { getBusinessHoursForDay, hhmmToMinutes } from './business-hours'
import { toOrgTime } from './timezone'

export type SlotGridInput = {
  startAt: string
  slotMinutes: number
  durationMinutes: number
  businessHours: BusinessHours | null
  timezone: string
  nowMs?: number
}

export function isStartAtOnGrid(input: SlotGridInput): boolean {
  if (input.slotMinutes <= 0 || input.durationMinutes <= 0) return false
  const startMs = new Date(input.startAt).getTime()
  if (!Number.isFinite(startMs)) return false
  if (startMs % 60_000 !== 0) return false
  if (input.nowMs !== undefined && startMs < input.nowMs) return false

  const local = toOrgTime(input.startAt, input.timezone)
  const startMin = local.hour * 60 + local.minute
  const endMin = startMin + input.durationMinutes

  const ranges = getBusinessHoursForDay(input.businessHours, local.dateISO, input.timezone)
  for (const range of ranges) {
    const openMin = hhmmToMinutes(range.open)
    const closeMin = hhmmToMinutes(range.close)
    if (startMin < openMin || endMin > closeMin) continue
    if ((startMin - openMin) % input.slotMinutes === 0) return true
  }
  return false
}
