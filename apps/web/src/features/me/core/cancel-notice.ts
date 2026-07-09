import type { CancellationPolicy, SelfCancelCheck } from '@/domain'

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

export function describeCancelReason(
  check: Exclude<SelfCancelCheck, { ok: true }>,
  policy: CancellationPolicy,
): string {
  switch (check.reason) {
    case 'already_cancelled':
      return 'Já cancelado.'
    case 'already_completed':
      return 'Já concluído.'
    case 'already_no_show':
      return 'Marcado como falta.'
    case 'past':
      return 'Horário já passou.'
    case 'outside_window':
      return `Cancele com pelo menos ${formatNoticeWindow(policy.minNoticeMinutes)} de antecedência.`
  }
}
