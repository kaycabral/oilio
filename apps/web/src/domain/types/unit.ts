import { Schema } from 'effect'

import { isValidSlug, slugify } from './slug'

export const UNIT_HOURS_MODES = ['fixed', 'always_open', 'appointment'] as const
export const UnitHoursMode = Schema.Literal(...UNIT_HOURS_MODES)
export type UnitHoursMode = typeof UnitHoursMode.Type

// Whether a unit's hours config means it offers the online agenda.
export function unitUsesAgenda(unit: { hoursMode: UnitHoursMode }): boolean {
  return unit.hoursMode === 'appointment'
}

// SPIKE (inferred availability): a unit's public booking page is live when it
// uses the agenda AND has a booking window (hours). No manual publish flag —
// "live" is derived from config. Service/professional readiness is surfaced to
// the owner as feedback but doesn't hard-gate the public page (an appointment
// unit with hours but no pro simply has no slots).
export function isUnitBookable(unit: {
  hoursMode: UnitHoursMode
  businessHours: BusinessHours
}): boolean {
  return unitUsesAgenda(unit)
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

// All-week-closed BusinessHours. Used only as the zero-value of the unit
// aggregate's INITIAL state (before any `unit.created` event applies) — never
// a persisted unit, since `parseUnitForm` rejects an empty hours config.
export const EMPTY_BUSINESS_HOURS: BusinessHours = {
  monday: null,
  tuesday: null,
  wednesday: null,
  thursday: null,
  friday: null,
  saturday: null,
  sunday: null,
}

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

// All-empty Address. Used only as the zero-value of the unit aggregate's
// INITIAL state (before any `unit.created` event applies) — never a persisted
// unit, since `parseUnitForm` requires a real address.
export const EMPTY_ADDRESS: Address = {
  postalCode: '',
  state: '',
  city: '',
  neighborhood: '',
  street: '',
  number: null,
  complement: null,
}

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
    // Genuinely a second channel — `whatsapp` is the required primary contact;
    // an email is nice-to-have, not an obligation of being an establishment.
    email: Schema.NullOr(Schema.String),
    // REQUIRED (PRD Identidade § Contrato de tipagem, v2): a Unidade is a real,
    // localizable, contactable establishment — every unit has a physical/
    // operational address. Was `NullOr<Address>` under v1's auto-matriz (which
    // birthed an address-less unit at signup); the v2 guided-first-unit flow
    // collects the address up front, so the schema now forbids the null state.
    address: Address,
    // REQUIRED (PRD Identidade § Contrato de tipagem, v2): how this unit's hours
    // work, WhatsApp-Business style. A unit with no hours mode can't operate an
    // agenda or booking, so the establishment must declare one.
    //  - 'fixed'       → open during the per-day ranges (walk-in / retail).
    //  - 'always_open' → 24h on the enabled days (stored as 00:00–23:59).
    //  - 'appointment' → per-day ranges that double as the booking window; this
    //                    is the marker that the unit USES the online agenda.
    hoursMode: UnitHoursMode,
    // REQUIRED (PRD Identidade § Contrato de tipagem, v2): every establishment
    // declares its operating hours — a unit with no hours can't operate the
    // agenda nor a booking window. Was `NullOr<BusinessHours>` under v1.
    businessHours: BusinessHours,
    // Uniform delete policy (brief 0027, AC-06). A referenced unit can't be
    // hard-deleted — it's archived instead (`archivedAt` set to an ISO
    // timestamp). Archived units drop out of active lists/pickers but stay
    // resolvable for historical references. `null` = active (not archived).
    archivedAt: Schema.NullOr(Schema.String),
    // The establishment's full CNPJ-14 (raiz(8) + ordem(4) + DV(2)), set when
    // the Org formalizes (brief 0048 AC-03/AC-06): the informal matriz becomes
    // the matriz `0001`. NON-PII (a PJ establishment's CNPJ is not personal —
    // the MEI civil-name nuance lives in the Org's deletable taxIdentity doc),
    // so it rides in `StoredUnit` + the `unit.updated` event. `undefined` while
    // informal.
    taxId: Schema.optional(Schema.String),
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
