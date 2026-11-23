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
