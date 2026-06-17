import { type BusinessHours, type UnitHoursMode, type Weekday, dayHoursToRanges } from '@/domain'

// Compact, human business-hours summary for the units list — covers every hours
// mode: `always_open` → "24h"; fixed/appointment → the open days (+ a uniform
// time range when every open day shares it). Pure + unit-tested.

// Display order (week starts Monday) + short pt-BR labels.
const ORDER: readonly Weekday[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]
const LABEL: Record<Weekday, string> = {
  monday: 'Seg',
  tuesday: 'Ter',
  wednesday: 'Qua',
  thursday: 'Qui',
  friday: 'Sex',
  saturday: 'Sáb',
  sunday: 'Dom',
}

function formatDays(open: Weekday[]): string {
  if (open.length === 7) return 'Todos os dias'
  // Open days in display order.
  const ordered = ORDER.filter((d) => open.includes(d))
  const idx = ordered.map((d) => ORDER.indexOf(d))
  const contiguous = idx.every((n, i) => i === 0 || n === idx[i - 1]! + 1)
  const first = ordered[0]
  const last = ordered[ordered.length - 1]
  // A run of 3+ contiguous days reads better as a range ("Seg a Sex"); 1–2 days
  // just list.
  if (contiguous && ordered.length > 2 && first && last) return `${LABEL[first]} a ${LABEL[last]}`
  return ordered.map((d) => LABEL[d]).join(', ')
}

function formatHHmm(s: string): string {
  const [h, m] = s.split(':')
  return m === '00' ? `${Number(h)}h` : `${Number(h)}h${m}`
}

// A single range that spans the whole day (stored as 00:00–23:59 by always_open,
// but a fixed unit can be configured the same way).
function isAllDay(r: { open: string; close: string }): boolean {
  return r.open === '00:00' && (r.close === '23:59' || r.close === '24:00' || r.close === '00:00')
}

function formatTime(
  unit: { hoursMode?: UnitHoursMode; businessHours: BusinessHours },
  open: Weekday[],
): string | null {
  if (unit.hoursMode === 'always_open') return '24h'
  // Only show a time when every open day shares one identical range; otherwise
  // the days summary stands on its own (no misleading single range).
  const ranges = open.map((d) => dayHoursToRanges(unit.businessHours[d]))
  if (ranges.some((r) => r.length !== 1)) return null
  const first = ranges[0]?.[0]
  if (!first) return null
  const uniform = ranges.every((r) => r[0]?.open === first.open && r[0]?.close === first.close)
  if (!uniform) return null
  return isAllDay(first) ? '24h' : `${formatHHmm(first.open)}–${formatHHmm(first.close)}`
}

// Returns the summary in two parts (days + optional time) so the UI can stack
// them on separate lines; null when there are no usable hours.
export function summarizeHours(unit: {
  hoursMode?: UnitHoursMode
  businessHours: BusinessHours | null
}): { days: string; time: string | null } | null {
  const bh = unit.businessHours
  if (!bh) return null
  const open = ORDER.filter((d) => dayHoursToRanges(bh[d]).length > 0)
  if (open.length === 0) return null
  return { days: formatDays(open), time: formatTime({ ...unit, businessHours: bh }, open) }
}
