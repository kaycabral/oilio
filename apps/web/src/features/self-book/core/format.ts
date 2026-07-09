export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`
}

export function formatNoticeWindow(minutes: number): string {
  if (minutes <= 0) return '0 minutos'
  if (minutes % 60 !== 0) return `${minutes} minutos`
  const hours = minutes / 60
  if (hours === 1) return '1 hora'
  if (hours < 24) return `${hours} horas`
  const days = hours / 24
  if (Number.isInteger(days)) return days === 1 ? '1 dia' : `${days} dias`
  return `${hours} horas`
}
