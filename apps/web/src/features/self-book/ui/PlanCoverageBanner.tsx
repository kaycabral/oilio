import type { AllowedTimeScope, BookingLimits, StoredUnit } from '@/domain'

// Brief 0019 Group D — AC-16. Discreet banner that reminds the
// subscribed customer of the coverage they actually have on this
// tenant. Server component — receives the already-resolved scope.
// Skips render entirely when every axis is unrestricted (avulso path
// or unrestricted plan): the avulso UX must not change.
export function PlanCoverageBanner({
  unitAllowlist,
  allowedTimeScope,
  bookingLimits,
  units,
}: {
  unitAllowlist: Set<string> | null
  allowedTimeScope: AllowedTimeScope | null
  bookingLimits: BookingLimits | null
  // Full list of units in the tenant — used to translate allow-listed
  // ids into human names. Order is rendered as-is (loader already sorts
  // by name).
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
  // Only `maxPerDay` is surfaced here. `maxConcurrent` and
  // `requireCompleteBeforeNext` are deliberately omitted — they're
  // behavioral guardrails against vaga-segurando (anti-abuse), not
  // shape of "what the plan covers". Surfacing them in a coverage
  // pitch would muddle the message; the enforcement message at
  // booking time already explains the rule in context.
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

// "Alvorada" → "Alvorada"
// "Alvorada", "Djalma" → "Alvorada e Djalma"
// "A", "B", "C" → "A, B e C"
function formatUnitsList(names: string[]): string {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]!
  if (names.length === 2) return `${names[0]} e ${names[1]}`
  const head = names.slice(0, -1).join(', ')
  const tail = names[names.length - 1]
  return `${head} e ${tail}`
}

// JS weekday index (0 = Sun … 6 = Sat) → short pt-BR label.
const WEEKDAY_SHORT_PT: Record<number, string> = {
  0: 'dom',
  1: 'seg',
  2: 'ter',
  3: 'qua',
  4: 'qui',
  5: 'sex',
  6: 'sáb',
}

// Pretty-print a sorted list of weekday indexes. Collapses contiguous
// Monday-Friday into "seg a sex" — the most common case — and falls
// back to a comma list otherwise. Doesn't try to be clever with other
// ranges (eg. "ter a qui"): not worth the cognitive cost for a banner.
function formatDaysOfWeek(days: readonly number[]): string {
  const sorted = [...days].sort((a, b) => a - b)
  // Monday-to-Friday collapses regardless of order in input.
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

// "08:00" → "08h", "08:30" → "08h30".
function formatHHmmPt(hhmm: string): string {
  const [h, m] = hhmm.split(':')
  if (!h || !m) return hhmm
  return m === '00' ? `${h}h` : `${h}h${m}`
}
