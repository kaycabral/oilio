// Resolve the current measurement period (`YYYY-MM`) in the org timezone.
// Pure + injectable clock so it's unit-testable and timezone-correct (storage
// is UTC, display/measurement is org-local — web/CLAUDE.md § Agenda).
export function currentPeriod(timezone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now)
  const year = parts.find((p) => p.type === 'year')?.value ?? ''
  const month = parts.find((p) => p.type === 'month')?.value ?? ''
  return `${year}-${month}`
}

// Human label for a `YYYY-MM` period, e.g. `2026-06` → "junho de 2026".
export function formatPeriodLabel(period: string): string {
  const [year, month] = period.split('-').map(Number)
  if (!year || !month) return period
  const date = new Date(Date.UTC(year, month - 1, 1))
  return new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}
