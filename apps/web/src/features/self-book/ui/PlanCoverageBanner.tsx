import type { AllowedTimeScope, BookingLimits, StoredUnit } from '@/domain'

export function PlanCoverageBanner({
  unitAllowlist,
  allowedTimeScope,
  bookingLimits,
  units,
}: {
  unitAllowlist: Set<string> | null
  allowedTimeScope: AllowedTimeScope | null
  bookingLimits: BookingLimits | null
  units: StoredUnit[]
}) {
  const parts: string[] = []

  if (unitAllowlist) {
    const names = units.filter((u) => unitAllowlist.has(u.id)).map((u) => u.name)
    if (names.length > 0) parts.push(formatUnitsList(names))
  }

  if (allowedTimeScope?.daysOfWeek && allowedTimeScope.daysOfWeek.length > 0) {
    parts.push(formatDaysOfWeek(allowedTimeScope.daysOfWeek))
  }
  if (allowedTimeScope?.hourRange) {
    parts.push(
      `${formatHHmmPt(allowedTimeScope.hourRange.start)} às ${formatHHmmPt(
        allowedTimeScope.hourRange.end,
      )}`,
    )
  }
  if (
    typeof allowedTimeScope?.advanceBookingDays === 'number' &&
    allowedTimeScope.advanceBookingDays > 0
  ) {
    const d = allowedTimeScope.advanceBookingDays
    parts.push(`até ${d} ${d === 1 ? 'dia' : 'dias'} de antecedência`)
  }
  if (typeof bookingLimits?.maxPerDay === 'number' && bookingLimits.maxPerDay > 0) {
    const n = bookingLimits.maxPerDay
    parts.push(`${n} ${n === 1 ? 'agendamento' : 'agendamentos'} por dia`)
  }

  if (parts.length === 0) return null

  return (
    <aside
      role="note"
      aria-label="Seu plano cobre"
      className="bg-muted/40 border-border text-foreground/90 rounded-md border px-3 py-2 text-xs"
    >
      <span className="text-muted-foreground">Seu plano cobre:</span>{' '}
      <span>{parts.join(', ')}.</span>
    </aside>
  )
}

function formatUnitsList(names: string[]): string {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]!
  if (names.length === 2) return `${names[0]} e ${names[1]}`
  const head = names.slice(0, -1).join(', ')
  const tail = names[names.length - 1]
  return `${head} e ${tail}`
}

const WEEKDAY_SHORT_PT: Record<number, string> = {
  0: 'dom',
  1: 'seg',
  2: 'ter',
  3: 'qua',
  4: 'qui',
  5: 'sex',
  6: 'sáb',
}

function formatDaysOfWeek(days: readonly number[]): string {
  const sorted = [...days].sort((a, b) => a - b)
  if (
    sorted.length === 5 &&
    sorted[0] === 1 &&
    sorted[1] === 2 &&
    sorted[2] === 3 &&
    sorted[3] === 4 &&
    sorted[4] === 5
  ) {
    return 'seg a sex'
  }
  return sorted
    .map((d) => WEEKDAY_SHORT_PT[d] ?? '')
    .filter(Boolean)
    .join(', ')
}

function formatHHmmPt(hhmm: string): string {
  const [h, m] = hhmm.split(':')
  if (!h || !m) return hhmm
  return m === '00' ? `${h}h` : `${h}h${m}`
}
