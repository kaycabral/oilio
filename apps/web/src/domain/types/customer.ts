import { Schema } from 'effect'
import { Attribution } from './attribution'

export const Customer = Schema.mutable(
  Schema.Struct({
    id: Schema.String,
    orgId: Schema.String,
    userId: Schema.String,
    name: Schema.String,
    mobile: Schema.String,
    birthDate: Schema.NullOr(Schema.String),
    avatarUrl: Schema.NullOr(Schema.String),
    archivedAt: Schema.NullOr(Schema.String),
    deactivatedAt: Schema.NullOr(Schema.String),
    acquisition: Schema.NullOr(Attribution),
    createdAt: Schema.String,
    updatedAt: Schema.String,
  }),
)
export type Customer = typeof Customer.Type

export const StoredCustomer = Customer.pipe(Schema.omit('name', 'mobile', 'birthDate', 'avatarUrl'))
export type StoredCustomer = typeof StoredCustomer.Type

export const BirthDateParseResult = Schema.Union(
  Schema.mutable(Schema.Struct({ ok: Schema.Literal(true), value: Schema.NullOr(Schema.String) })),
  Schema.mutable(Schema.Struct({ ok: Schema.Literal(false), error: Schema.String })),
)
export type BirthDateParseResult = typeof BirthDateParseResult.Type

export function parseBirthDate(raw: string, today: Date = new Date()): BirthDateParseResult {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return { ok: true, value: null }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return { ok: false, error: 'Data de nascimento inválida' }
  }
  const [year, month, day] = trimmed.split('-').map((s) => Number(s))
  if (year === undefined || month === undefined || day === undefined) {
    return { ok: false, error: 'Data de nascimento inválida' }
  }
  if (year < 1900) return { ok: false, error: 'Ano de nascimento muito antigo' }
  const candidate = new Date(year, month - 1, day)
  if (
    Number.isNaN(candidate.getTime()) ||
    candidate.getFullYear() !== year ||
    candidate.getMonth() !== month - 1 ||
    candidate.getDate() !== day
  ) {
    return { ok: false, error: 'Data de nascimento inválida' }
  }
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  if (trimmed > todayIso) {
    return { ok: false, error: 'Data de nascimento não pode ser no futuro' }
  }
  return { ok: true, value: trimmed }
}

export function formatBirthDate(birthDate: string | null): string {
  if (!birthDate) return '—'
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate)
  if (!match) return '—'
  const [, year, month, day] = match
  return `${day}/${month}/${year}`
}
