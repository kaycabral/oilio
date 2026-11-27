import { parseBRLInput } from '@cbrl/br/money'

export function formString(form: FormData, key: string): string {
  const value = form.get(key)
  return typeof value === 'string' ? value : ''
}

export function parseCentsInput(raw: string): number | null {
  const trimmed = raw.trim()
  return trimmed === '' ? 0 : parseBRLInput(trimmed)
}

export function formCents(form: FormData, key: string): number | null {
  return parseCentsInput(formString(form, key))
}
