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
