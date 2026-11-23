export function isBirthdayToday(birthDate: string, now: number = Date.now()): boolean {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(birthDate)
  if (!m) return false
  const today = new Date(now)
  const mm = String(today.getMonth() + 1).padStart(2, '0')
  const dd = String(today.getDate()).padStart(2, '0')
  return m[1] === mm && m[2] === dd
}
