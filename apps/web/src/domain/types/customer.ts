import { Schema } from 'effect'
import { Attribution } from './attribution'

// `Customer` is the **conceptual entity** of a person known to a org —
// what every read site and UI component handles. PII (name, mobile,
// birthDate) is materialized into this shape at read time by the
// server, but the canonical storage lives on the global `users/{userId}`
// doc (referenced via `userId`). The account `email` is NOT materialized
// here: it is our SaaS account datum (the identity login), never surfaced to
// the establishment (brief 0077 — WhatsApp is the customer comms channel).
// Per-org `orgs/{t}/customers/{id}`
// only persists operational data (eventual scores). Schema
// decided in #832 + #836 — canonical doc:
// https://github.com/cbrl-dev/cbrl/wiki/02-Estrategia-Modelo-Identidade
//
// The storage shape (what's in Firestore) is intentionally not exported —
// it's an implementation detail of the read/write helpers in
// `apps/oilio/web/src/lib/org/customer-{read,upsert}.ts`. Callers
// outside that boundary never need to think about the split.

export const Customer = Schema.mutable(
  Schema.Struct({
    id: Schema.String,
    orgId: Schema.String,
    // FK into `users/{userId}` (top-level). Required — no PII-only customers.
    userId: Schema.String,
    // Materialized from `User` at read time. UI components consume these
    // directly and don't need to know about the User/Customer split.
    name: Schema.String,
    mobile: Schema.String,
    birthDate: Schema.NullOr(Schema.String),
    // Materialized from `User.avatarUrl` at read time. Neutralized (null) for a
    // customer blocked in this org (LGPD art. 18 — brief 0032, AC-13: the
    // photo is a re-identification vector, so it's blanked alongside the name).
    avatarUrl: Schema.NullOr(Schema.String),
    // Per-org terminal block (LGPD art. 18 "bloqueio" — brief 0032, AC-09/
    // AC-11). When set, the customer shadow is archived: dropped from active
    // lists/pickers, write-guarded, history resolves to the neutral label. This
    // is the materialized projection of the `blocked_subjects/{userId}` marker
    // (the fact of record), persisted on the customer doc (self-describing,
    // indexable, fail-safe). The global `users/{uid}` account stays intact.
    archivedAt: Schema.NullOr(Schema.String),
    // Operator-side removal (brief 0033, AC-07 — NOT LGPD). When the team
    // "Excludes" a customer who has history (closed orders), the shadow is kept
    // so historical records still resolve the **name** — but the customer drops
    // out of active lists/pickers. Distinct from `archivedAt` on purpose: this is
    // the *operational* relationship ending (any reason, identifiable), never the
    // LGPD block (which alone drives the neutral label). Keeping them as separate
    // fields means the two relations never get conflated (mapa Ciclo de Vida e
    // Exclusão). A no-footprint customer is hard-deleted instead of deactivated.
    deactivatedAt: Schema.NullOr(Schema.String),
    // ACQUISITION attribution (brief 0077, Grupo D — AC-10/AC-11). The first
    // touch that created the relationship: which channel/campaign brought this
    // person to this org. WRITE-ONCE — set on materialization and never
    // overwritten by a later visit (a returning client booking via another
    // channel records that on the Appointment, not here). PII-zero (channel +
    // ids only), so it is safe to read into `track()`. Null for legacy/seed
    // customers materialized before the model existed (greenfield — no migration).
    acquisition: Schema.NullOr(Attribution),
    createdAt: Schema.String,
    updatedAt: Schema.String,
  }),
)
export type Customer = typeof Customer.Type

// Storage projection of `Customer`: the per-org `customers/{id}` doc that
// OMITS the PII (name/whatsapp/birthDate/avatarUrl) materialized from
// `users/` at read time. Decode raw `customers` docs against this — decoding
// against the full `Customer` would fail by design (the PII isn't stored).
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
