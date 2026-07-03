import { Schema } from 'effect'

import type { WhatsappTemplates } from '../utils/whatsapp'
import { isValidSlug, slugify } from './slug'
import { INFORMAL_UNIT_FISCAL, UnitFiscal } from './tax'

export const UNIT_HOURS_MODES = ['fixed', 'always_open', 'appointment'] as const
export const UnitHoursMode = Schema.Literal(...UNIT_HOURS_MODES)
export type UnitHoursMode = typeof UnitHoursMode.Type

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

// Narrows an unknown to an indexable record without asserting — lets the
// `normalize*` parsers read fields off untrusted input cast-free (each field is
// then guarded by its own typeof/validator check).
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export const SlotMinutes = Schema.Literal(5, 10, 15, 30)
export type SlotMinutes = typeof SlotMinutes.Type

export const SLOT_MINUTES_OPTIONS = [5, 10, 15, 30] as const satisfies readonly SlotMinutes[]

export function isValidSlotMinutes(v: unknown): v is SlotMinutes {
  return SLOT_MINUTES_OPTIONS.some((o) => o === v)
}

export const DEFAULT_SLOT_MINUTES: SlotMinutes = 15

// Opt-in self-service cancellation policy. When `enabled = false`, the public
// pre-booking screen shows no policy copy and cancel/reschedule UX has zero
// friction. Tracking on Appointment is always populated regardless of this
// flag — the flag only gates customer-facing communication. Wiki:
// 04-Roadmap-Politica-Cancelamento. Moved Org→Unit (PRD Identidade v2): it's an
// appointment-agenda concern of the establishment, not the Org folder.
export const CancellationPolicy = Schema.mutable(
  Schema.Struct({
    enabled: Schema.Boolean,
    minNoticeMinutes: Schema.Number,
  }),
)
export type CancellationPolicy = typeof CancellationPolicy.Type

export const DEFAULT_CANCELLATION_POLICY: CancellationPolicy = {
  enabled: false,
  minNoticeMinutes: 120,
}

export const MIN_CANCELLATION_NOTICE_MINUTES = 0
export const MAX_CANCELLATION_NOTICE_MINUTES = 7 * 24 * 60

export function isValidCancellationNoticeMinutes(v: unknown): v is number {
  return (
    typeof v === 'number' &&
    Number.isFinite(v) &&
    Number.isInteger(v) &&
    v >= MIN_CANCELLATION_NOTICE_MINUTES &&
    v <= MAX_CANCELLATION_NOTICE_MINUTES
  )
}

export function normalizeCancellationPolicy(raw: unknown): CancellationPolicy {
  if (!isRecord(raw)) return { ...DEFAULT_CANCELLATION_POLICY }
  const r = raw
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : DEFAULT_CANCELLATION_POLICY.enabled,
    minNoticeMinutes: isValidCancellationNoticeMinutes(r.minNoticeMinutes)
      ? r.minNoticeMinutes
      : DEFAULT_CANCELLATION_POLICY.minNoticeMinutes,
  }
}

// `WhatsappTemplates` (a hand-written `type` in `../utils/whatsapp`, outside the
// read-model kernel) projected as a schema so the appointment agenda's
// `confirmationTemplates` field stays a single source of truth here. The
// `_proof` below pins it to the canonical type — drift fails the build. Moved
// Org→Unit (PRD Identidade v2): confirmation/reminder/cancellation messages are
// an appointment-agenda concern of the establishment.
const ConfirmationTemplatesSchema = Schema.mutable(
  Schema.Struct({
    confirmation: Schema.String,
    reminder: Schema.String,
    cancellation: Schema.String,
  }),
)
export const ConfirmationTemplates = ConfirmationTemplatesSchema
export type ConfirmationTemplates = typeof ConfirmationTemplatesSchema.Type
type _ProofConfirmationTemplates = [
  typeof ConfirmationTemplatesSchema.Type extends WhatsappTemplates ? true : false,
  WhatsappTemplates extends typeof ConfirmationTemplatesSchema.Type ? true : false,
]
const _proofConfirmationTemplates: _ProofConfirmationTemplates = [true, true]
void _proofConfirmationTemplates

// The unit's agenda configuration — a discriminated union by hours mode (PRD
// Identidade v2 § Contrato de tipagem). This REPLACES the flat `hoursMode` +
// `businessHours` fields. The agenda-only configs (slotMinutes,
// cancellationPolicy, confirmationTemplates, self-booking publish state) live
// ONLY in the `appointment` variant, so they CANNOT exist outside agenda mode —
// there is no nullable agenda config.
//  - 'fixed'       → open during the per-day ranges (walk-in / retail).
//  - 'always_open' → 24h on the enabled days (stored as 00:00–23:59).
//  - 'appointment' → per-day ranges that double as the booking window; this is
//                    the marker that the unit USES the online agenda, and the
//                    only variant that carries the agenda-only configs.
export const UnitAgendaFixed = Schema.mutable(
  Schema.Struct({
    mode: Schema.Literal('fixed'),
    businessHours: BusinessHours,
  }),
)
export type UnitAgendaFixed = typeof UnitAgendaFixed.Type

export const UnitAgendaAlwaysOpen = Schema.mutable(
  Schema.Struct({
    mode: Schema.Literal('always_open'),
  }),
)
export type UnitAgendaAlwaysOpen = typeof UnitAgendaAlwaysOpen.Type

export const UnitAgendaAppointment = Schema.mutable(
  Schema.Struct({
    mode: Schema.Literal('appointment'),
    businessHours: BusinessHours,
    // Slot grid granularity — only exists in appointment mode (moved from Org).
    slotMinutes: SlotMinutes,
    // Self-service cancellation policy — only exists in appointment mode (moved
    // from Org).
    cancellationPolicy: CancellationPolicy,
    // Confirmation/reminder/cancellation message templates — only exists in
    // appointment mode (moved from Org).
    confirmationTemplates: ConfirmationTemplates,
  }),
)
export type UnitAgendaAppointment = typeof UnitAgendaAppointment.Type

export const UnitAgendaConfig = Schema.Union(
  UnitAgendaFixed,
  UnitAgendaAlwaysOpen,
  UnitAgendaAppointment,
)
export type UnitAgendaConfig = typeof UnitAgendaConfig.Type

// Zero-value agenda for the unit aggregate's INITIAL state (before any
// `unit.created` event applies) — never a persisted unit, since
// `parseUnitForm` builds a real agenda.
export const EMPTY_AGENDA_CONFIG: UnitAgendaConfig = {
  mode: 'fixed',
  businessHours: EMPTY_BUSINESS_HOURS,
}

// Whether a unit's agenda config means it offers the online agenda.
export function unitUsesAgenda(unit: { agenda: UnitAgendaConfig }): boolean {
  return unit.agenda.mode === 'appointment'
}

// SPIKE (inferred availability): a unit's public booking page is live when it
// uses the agenda (appointment mode). Service/memberOperation readiness is
// surfaced to the owner as feedback but doesn't hard-gate the public page (an
// appointment unit with hours but no pro simply has no slots).
export function isUnitBookable(unit: { agenda: UnitAgendaConfig }): boolean {
  return unitUsesAgenda(unit)
}

// The unit's operating hours regardless of mode — null for `always_open` (open
// 24h, no per-day ranges). Lets consumers read hours without branching on the
// agenda union shape.
export function unitBusinessHours(agenda: UnitAgendaConfig): BusinessHours | null {
  return agenda.mode === 'always_open' ? null : agenda.businessHours
}

// Narrowed accessor for the appointment-only configs. Returns null outside
// appointment mode, where the agenda-only configs do not exist by construction.
export function appointmentAgenda(agenda: UnitAgendaConfig): UnitAgendaAppointment | null {
  return agenda.mode === 'appointment' ? agenda : null
}

// The slot grid granularity for a unit's agenda — the appointment-only
// `slotMinutes`, or the default when the unit isn't in appointment mode (the
// config doesn't exist there). Lets agenda readers stay branch-free.
export function unitSlotMinutes(agenda: UnitAgendaConfig): SlotMinutes {
  return agenda.mode === 'appointment' ? agenda.slotMinutes : DEFAULT_SLOT_MINUTES
}

// The publish-readiness predicates that COMPOSE the business-hours util
// (`unitHasUsableHours`, `unitHasAddressAndHours`, `isUnitPubliclyLive`) live in
// `../utils/business-hours`. Keeping them here would make this types module
// import a util that imports types back from here — a no-circular violation.

// The cancellation policy to snapshot onto a booking: the appointment-agenda
// policy, or the default outside appointment mode (the policy doesn't exist
// there). Normalized so a partial/legacy value can't leak through. Used when
// committing an appointment (snapshot-on-use) — editing the unit policy later
// never retroacts on an existing booking.
export function unitCancellationPolicySnapshot(agenda: UnitAgendaConfig): CancellationPolicy {
  const appointment = appointmentAgenda(agenda)
  return normalizeCancellationPolicy(appointment?.cancellationPolicy ?? DEFAULT_CANCELLATION_POLICY)
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

// Whether an address carries the fields a real unit must have. The `Address`
// schema itself tolerates empty strings because the unit aggregate's INITIAL
// state (before `unit.created`) needs a zero-value (`EMPTY_ADDRESS`) — so the
// "is this a real, filled address" invariant lives HERE, as an explicit
// predicate, not in the bare schema. This is the single source of truth for
// "address complete": `parseUnitForm` enforces it at the form boundary,
// publish-readiness uses it to gate the public page, and `CompleteAddress`
// (below) wraps it as a schema filter so the `unit.created`/`unit.updated`
// event decode rejects a blank address. `number`/`complement` stay optional
// (many addresses legitimately lack them).
export function isAddressComplete(address: Address): boolean {
  return (
    address.postalCode.trim().length > 0 &&
    address.state.trim().length > 0 &&
    address.city.trim().length > 0 &&
    address.neighborhood.trim().length > 0 &&
    address.street.trim().length > 0
  )
}

// The `Address` carried by a PERSISTED unit (`unit.created` payload, #1283 /
// brief 0078 AC-05). `Address` itself stays permissive for the aggregate's
// INITIAL zero-value (`EMPTY_ADDRESS`); this filtered schema is the boundary the
// event decode runs through, so a blank address is rejected at `appendEventToTx`
// — not only by the `parseUnitForm` shell or the DB CHECK.
export const CompleteAddress = Address.pipe(
  Schema.filter(isAddressComplete, {
    identifier: 'CompleteAddress',
    message: () => 'address must be complete (postalCode, state, city, neighborhood, street)',
  }),
)
export type CompleteAddress = typeof CompleteAddress.Type

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

// Default timezone for a new establishment (moved from Org — PRD Identidade v2:
// the timezone is the establishment's, not the folder's).
export const DEFAULT_UNIT_TIMEZONE = 'America/Sao_Paulo'

export const Unit = Schema.mutable(
  Schema.Struct({
    id: Schema.String,
    orgId: Schema.String,
    name: Schema.String,
    // Path segment used in the public unit-scoped URL `/{orgSlug}/{slug}`.
    // Unique within org (cross-org collisions are allowed — two orgs
    // can each have a `centro`). See #873.
    slug: Schema.String,
    // Public-facing mobile for confirmations, reminders and customer fallback
    // contact. Stored normalized via `normalizeBrazilPhone`. Required — decided
    // in #822: per-unit number, no Org-level number.
    mobile: Schema.String,
    // Optional second channel (docs, corporate contact). null when absent.
    // Genuinely a second channel — `mobile` is the required primary contact;
    // an email is nice-to-have, not an obligation of being an establishment.
    email: Schema.NullOr(Schema.String),
    // REQUIRED (PRD Identidade § Contrato de tipagem, v2): a Unidade is a real,
    // localizable, contactable establishment — every unit has a physical/
    // operational address. Was `NullOr<Address>` under v1's auto-matriz (which
    // birthed an address-less unit at signup); the v2 guided-first-unit flow
    // collects the address up front, so the schema now forbids the null state.
    address: Address,
    // REQUIRED (PRD Identidade § Contrato de tipagem, v2): the establishment's
    // own timezone (moved from Org — the timezone belongs to where the operation
    // physically happens, not the Org folder). Storage UTC / display unit-tz.
    timezone: Schema.String,
    // REQUIRED (PRD Identidade § Contrato de tipagem, v2): the unit's agenda
    // configuration as a discriminated union by hours mode. REPLACES the flat
    // `hoursMode` + `businessHours`. The agenda-only configs (slotMinutes,
    // cancellationPolicy, confirmationTemplates, self-booking publish state)
    // exist ONLY in the `appointment` variant — they cannot exist outside agenda
    // mode (no nullable agenda config). See `UnitAgendaConfig`.
    agenda: UnitAgendaConfig,
    // Uniform delete policy (brief 0027, AC-06). A referenced unit can't be
    // hard-deleted — it's archived instead (`archivedAt` set to an ISO
    // timestamp). Archived units drop out of active lists/pickers but stay
    // resolvable for historical references. `null` = active (not archived).
    archivedAt: Schema.NullOr(Schema.String),
    // The establishment's fiscal identity (PRD Identidade v2 § Contrato de
    // tipagem, brief 0048): a discriminated union, NOT a nullable CNPJ field —
    // the CNPJ literally does not exist without formalization. A Unit is born
    // `{ kind: 'informal' }` and becomes `{ kind: 'company', taxId, ... }` via
    // the `unit.formalized` event. NON-PII (a PJ establishment's CNPJ + registry
    // data are not personal — the MEI civil-name nuance lives in the deletable
    // `units/{id}/private/taxIdentity` doc), so it rides in `StoredUnit` + the
    // event payload. The read path backfills a missing field to informal.
    fiscal: UnitFiscal,
    createdAt: Schema.String,
    updatedAt: Schema.String,
  }),
)
export type Unit = typeof Unit.Type

// Storage projection of `Unit`: the per-org `units/{id}` doc that OMITS the
// PII contact channels (mobile/email), which live in the deletable
// `units_pii/{id}` doc and are merged at read time. Decode raw `units` docs
// against this.
export const StoredUnit = Unit.pipe(Schema.omit('mobile', 'email'))
export type StoredUnit = typeof StoredUnit.Type

// The complement of `StoredUnit`: the deletable `units_pii/{id}` doc. Defined
// from the same base so the omit (storage) and pick (PII sidecar) can't drift.
export const UnitPii = Unit.pipe(Schema.pick('mobile', 'email'))
export type UnitPii = typeof UnitPii.Type

// A new unit is born informal — no CNPJ until the owner formalizes it (brief
// 0048). Re-exported zero-value so create flows / the aggregate seed a single
// source.
export const DEFAULT_UNIT_FISCAL: UnitFiscal = INFORMAL_UNIT_FISCAL

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
