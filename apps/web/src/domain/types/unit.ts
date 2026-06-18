import { Schema } from 'effect'

import { isValidSlug, slugify } from './slug'

export const UNIT_HOURS_MODES = ['fixed', 'always_open', 'appointment'] as const
export const UnitHoursMode = Schema.Literal(...UNIT_HOURS_MODES)
export type UnitHoursMode = typeof UnitHoursMode.Type

// Whether a unit's hours config means it offers the online agenda.
export function unitUsesAgenda(unit: { hoursMode?: UnitHoursMode }): boolean {
  return unit.hoursMode === 'appointment'
}

// SPIKE (inferred availability): a unit's public booking page is live when it
// uses the agenda AND has a booking window (hours). No manual publish flag —
// "live" is derived from config. Service/professional readiness is surfaced to
// the owner as feedback but doesn't hard-gate the public page (an appointment
// unit with hours but no pro simply has no slots).
export function isUnitBookable(unit: {
  hoursMode?: UnitHoursMode
  businessHours: BusinessHours | null
}): boolean {
  return unitUsesAgenda(unit) && unit.businessHours !== null
}

export const HoursRange = Schema.mutable(
  Schema.Struct({
    open: Schema.String,
    close: Schema.String,
  }),
)
export type HoursRange = typeof HoursRange.Type

// SPIKE (multi-interval): a weekday's open windows. Legacy data is a single
// range or `null` (closed); the multi-interval model (split shifts / lunch
// breaks) stores an array. `getBusinessHoursForDay` normalizes all three to
// `HoursRange[]`, so consumers never branch on the shape.
export const DayHours = Schema.Union(HoursRange, Schema.Array(HoursRange), Schema.Null)
export type DayHours = typeof DayHours.Type

export const BusinessHours = Schema.mutable(
  Schema.Struct({
    monday: DayHours,
    tuesday: DayHours,
    wednesday: DayHours,
    thursday: DayHours,
    friday: DayHours,
    saturday: DayHours,
    sunday: DayHours,
  }),
)
export type BusinessHours = typeof BusinessHours.Type

// Normalize a stored day value to a flat list of ranges (empty = closed).
export function dayHoursToRanges(value: DayHours): HoursRange[] {
  if (value === null || value === undefined) return []
  // `'open' in value` narrows the single-range case (a readonly array has no
  // `open`); `Array.isArray` alone doesn't strip a `readonly[]` from the union.
  return 'open' in value ? [value] : [...value]
}

export const Address = Schema.mutable(
  Schema.Struct({
    postalCode: Schema.String,
    state: Schema.String,
    city: Schema.String,
    neighborhood: Schema.String,
    street: Schema.String,
    number: Schema.NullOr(Schema.String),
    complement: Schema.NullOr(Schema.String),
  }),
)
export type Address = typeof Address.Type

export const Unit = Schema.mutable(
  Schema.Struct({
    id: Schema.String,
    orgId: Schema.String,
    name: Schema.String,
    // Path segment used in the public unit-scoped URL `/{orgSlug}/{slug}`.
    // Unique within org (cross-org collisions are allowed — two orgs
    // can each have a `centro`). See #873.
    slug: Schema.String,
    // Public-facing WhatsApp for confirmations, reminders and customer fallback
    // contact. Stored normalized via `normalizeBrazilPhone`. Required — decided
    // in #822: per-unit WA, no Org-level WA.
    whatsapp: Schema.String,
    // Optional second channel (docs, corporate contact). null when absent.
    email: Schema.NullOr(Schema.String),
    address: Schema.NullOr(Address),
    // SPIKE (hours mode): how this unit's hours work, WhatsApp-Business style.
    //  - 'fixed'       → open during the per-day ranges (walk-in / retail).
    //  - 'always_open' → 24h on the enabled days (stored as 00:00–23:59).
    //  - 'appointment' → per-day ranges that double as the booking window; this
    //                    is the marker that the unit USES the online agenda.
    // `undefined` = legacy unit (treated as 'fixed').
    hoursMode: Schema.optional(UnitHoursMode),
    businessHours: Schema.NullOr(BusinessHours),
    // Uniform delete policy (brief 0027, AC-06). A referenced unit can't be
    // hard-deleted — it's archived instead (`archivedAt` set to an ISO
    // timestamp). Archived units drop out of active lists/pickers but stay
    // resolvable for historical references. `null` = active (not archived).
    archivedAt: Schema.NullOr(Schema.String),
    createdAt: Schema.String,
    updatedAt: Schema.String,
  }),
)
export type Unit = typeof Unit.Type

// Storage projection of `Unit`: the per-org `units/{id}` doc that OMITS the
// PII contact channels (whatsapp/email), which live in the deletable
// `units_pii/{id}` doc and are merged at read time. Decode raw `units` docs
// against this.
export const StoredUnit = Unit.pipe(Schema.omit('whatsapp', 'email'))
export type StoredUnit = typeof StoredUnit.Type

// The complement of `StoredUnit`: the deletable `units_pii/{id}` doc. Defined
// from the same base so the omit (storage) and pick (PII sidecar) can't drift.
export const UnitPii = Unit.pipe(Schema.pick('whatsapp', 'email'))
export type UnitPii = typeof UnitPii.Type

// Reserved slugs for the per-org public namespace. A unit slug must not
// collide with a sibling route under `/{orgSlug}/...` (e.g. `/me`,
// `/book`, `/booking`). Kept distinct from `RESERVED_SLUGS` — that one
// guards the top-level namespace; this one will evolve as public routes
// under org scope land (#841, #842, #844).
export const RESERVED_UNIT_SLUGS = new Set<string>([
  'admin',
  'api',
  'availability',
  'book',
  'booking',
  'me',
  'new',
  'settings',
  'signup',
  'support',
  'units',
])

export function isReservedUnitSlug(value: string): boolean {
  return RESERVED_UNIT_SLUGS.has(value)
}

export function slugifyUnitName(name: string): string {
  return slugify(name)
}

export function isValidUnitSlug(value: string): boolean {
  return isValidSlug(value) && !RESERVED_UNIT_SLUGS.has(value)
}
