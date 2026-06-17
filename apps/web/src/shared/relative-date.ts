// Pure relative-date formatting for list/detail date columns. Buckets, by how
// far the date is from now:
//   - same calendar day  → relative hours/minutes ("agora", "há 15min", "há 2h",
//                           "em 3h")
//   - yesterday / tomorrow → "ontem" / "amanhã"
//   - near FUTURE (2…14d) → "em N dias" (forward-looking is useful — e.g. a next
//                           charge); near PAST beyond yesterday is NOT relative
//   - everything else     → short absolute "dd/MM/yy"
// Calendar-day based for the day buckets, so they flip at midnight (not on a
// rolling 24h). Shared across features (subscriptions' next charge, orders'
// closed/opened date, …).

const RELATIVE_WINDOW_DAYS = 14

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function shortDate(d: Date): string {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

export function formatRelativeDate(iso: string, now: number = Date.now()): string {
  const target = new Date(iso)
  const ms = target.getTime() - now
  const days = Math.round((startOfDay(target) - startOfDay(new Date(now))) / 86_400_000)

  if (days === 0) {
    if (Math.abs(ms) < 60_000) return 'agora'
    const minutes = Math.floor(Math.abs(ms) / 60_000)
    const unit = minutes < 60 ? `${minutes}min` : `${Math.floor(minutes / 60)}h`
    return ms < 0 ? `há ${unit}` : `em ${unit}`
  }
  if (days === 1) return 'amanhã'
  if (days === -1) return 'ontem'
  if (days > 1 && days <= RELATIVE_WINDOW_DAYS) return `em ${days} dias`
  return shortDate(target)
}
