import { Schema, Struct } from 'effect'

import type { WhatsappTemplates } from '../utils/whatsapp'
import { isValidSlug, slugify } from './slug'
import { INFORMAL_UNIT_FISCAL, UnitFiscal } from './tax'

export const UNIT_HOURS_MODES = ['fixed', 'always_open', 'appointment'] as const
export const UnitHoursMode = Schema.Literals(UNIT_HOURS_MODES)
export type UnitHoursMode = typeof UnitHoursMode.Type

export const HoursRange = Schema.Struct({
  open: Schema.String,
  close: Schema.String,
}).mapFields(Struct.map(Schema.mutableKey))
export type HoursRange = typeof HoursRange.Type

export const DayHours = Schema.Union([HoursRange, Schema.Array(HoursRange), Schema.Null])
export type DayHours = typeof DayHours.Type

export const BusinessHours = Schema.Struct({
  monday: DayHours,
  tuesday: DayHours,
  wednesday: DayHours,
  thursday: DayHours,
  friday: DayHours,
  saturday: DayHours,
  sunday: DayHours,
}).mapFields(Struct.map(Schema.mutableKey))
export type BusinessHours = typeof BusinessHours.Type

export const EMPTY_BUSINESS_HOURS: BusinessHours = {
  monday: null,
  tuesday: null,
  wednesday: null,
  thursday: null,
  friday: null,
  saturday: null,
  sunday: null,
}

export function dayHoursToRanges(value: DayHours): HoursRange[] {
  if (value === null || value === undefined) return []
  return 'open' in value ? [value] : [...value]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export const SlotMinutes = Schema.Literals([5, 10, 15, 30])
export type SlotMinutes = typeof SlotMinutes.Type

export const SLOT_MINUTES_OPTIONS = [5, 10, 15, 30] as const satisfies readonly SlotMinutes[]

export function isValidSlotMinutes(v: unknown): v is SlotMinutes {
  return SLOT_MINUTES_OPTIONS.some((o) => o === v)
}

export const DEFAULT_SLOT_MINUTES: SlotMinutes = 15

export const CancellationPolicy = Schema.Struct({
  enabled: Schema.Boolean,
  minNoticeMinutes: Schema.Number,
}).mapFields(Struct.map(Schema.mutableKey))
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

const ConfirmationTemplatesSchema = Schema.Struct({
  confirmation: Schema.String,
  reminder: Schema.String,
  cancellation: Schema.String,
}).mapFields(Struct.map(Schema.mutableKey))
export const ConfirmationTemplates = ConfirmationTemplatesSchema
export type ConfirmationTemplates = typeof ConfirmationTemplatesSchema.Type
type _ProofConfirmationTemplates = [
  typeof ConfirmationTemplatesSchema.Type extends WhatsappTemplates ? true : false,
  WhatsappTemplates extends typeof ConfirmationTemplatesSchema.Type ? true : false,
]
const _proofConfirmationTemplates: _ProofConfirmationTemplates = [true, true]
void _proofConfirmationTemplates

export const UnitAgendaFixed = Schema.Struct({
  mode: Schema.Literal('fixed'),
  businessHours: BusinessHours,
}).mapFields(Struct.map(Schema.mutableKey))
export type UnitAgendaFixed = typeof UnitAgendaFixed.Type

export const UnitAgendaAlwaysOpen = Schema.Struct({
  mode: Schema.Literal('always_open'),
}).mapFields(Struct.map(Schema.mutableKey))
export type UnitAgendaAlwaysOpen = typeof UnitAgendaAlwaysOpen.Type

export const UnitAgendaAppointment = Schema.Struct({
  mode: Schema.Literal('appointment'),
  businessHours: BusinessHours,
  slotMinutes: SlotMinutes,
  cancellationPolicy: CancellationPolicy,
  confirmationTemplates: ConfirmationTemplates,
}).mapFields(Struct.map(Schema.mutableKey))
export type UnitAgendaAppointment = typeof UnitAgendaAppointment.Type

export const UnitAgendaConfig = Schema.Union([
  UnitAgendaFixed,
  UnitAgendaAlwaysOpen,
  UnitAgendaAppointment,
])
export type UnitAgendaConfig = typeof UnitAgendaConfig.Type

export const EMPTY_AGENDA_CONFIG: UnitAgendaConfig = {
  mode: 'fixed',
  businessHours: EMPTY_BUSINESS_HOURS,
}

export function unitUsesAgenda(unit: { agenda: UnitAgendaConfig }): boolean {
  return unit.agenda.mode === 'appointment'
}

export function isUnitBookable(unit: { agenda: UnitAgendaConfig }): boolean {
  return unitUsesAgenda(unit)
}

export function unitBusinessHours(agenda: UnitAgendaConfig): BusinessHours | null {
  return agenda.mode === 'always_open' ? null : agenda.businessHours
}

export function appointmentAgenda(agenda: UnitAgendaConfig): UnitAgendaAppointment | null {
  return agenda.mode === 'appointment' ? agenda : null
}

export function unitSlotMinutes(agenda: UnitAgendaConfig): SlotMinutes {
  return agenda.mode === 'appointment' ? agenda.slotMinutes : DEFAULT_SLOT_MINUTES
}

export function unitCancellationPolicySnapshot(agenda: UnitAgendaConfig): CancellationPolicy {
  const appointment = appointmentAgenda(agenda)
  return normalizeCancellationPolicy(appointment?.cancellationPolicy ?? DEFAULT_CANCELLATION_POLICY)
}

export const Address = Schema.Struct({
  postalCode: Schema.String,
  state: Schema.String,
  city: Schema.String,
  neighborhood: Schema.String,
  street: Schema.String,
  number: Schema.NullOr(Schema.String),
  complement: Schema.NullOr(Schema.String),
}).mapFields(Struct.map(Schema.mutableKey))
export type Address = typeof Address.Type

export function isAddressComplete(address: Address): boolean {
  return (
    address.postalCode.trim().length > 0 &&
    address.state.trim().length > 0 &&
    address.city.trim().length > 0 &&
    address.neighborhood.trim().length > 0 &&
    address.street.trim().length > 0
  )
}

export const CompleteAddress = Address.pipe(
  Schema.check(
    Schema.makeFilter(isAddressComplete, {
      identifier: 'CompleteAddress',
      message: 'address must be complete (postalCode, state, city, neighborhood, street)',
    }),
  ),
)
export type CompleteAddress = typeof CompleteAddress.Type

export const EMPTY_ADDRESS: Address = {
  postalCode: '',
  state: '',
  city: '',
  neighborhood: '',
  street: '',
  number: null,
  complement: null,
}

export const DEFAULT_UNIT_TIMEZONE = 'America/Sao_Paulo'

export const Unit = Schema.Struct({
  id: Schema.String,
  orgId: Schema.String,
  name: Schema.String,
  slug: Schema.String,
  mobile: Schema.String,
  email: Schema.NullOr(Schema.String),
  address: Address,
  timezone: Schema.String,
  agenda: UnitAgendaConfig,
  archivedAt: Schema.NullOr(Schema.String),
  fiscal: UnitFiscal,
  createdAt: Schema.String,
  updatedAt: Schema.String,
}).mapFields(Struct.map(Schema.mutableKey))
export type Unit = typeof Unit.Type

export const StoredUnit = Unit.mapFields(Struct.omit(['mobile', 'email']))
export type StoredUnit = typeof StoredUnit.Type

export const UnitPii = Unit.mapFields(Struct.pick(['mobile', 'email']))
export type UnitPii = typeof UnitPii.Type

export const DEFAULT_UNIT_FISCAL: UnitFiscal = INFORMAL_UNIT_FISCAL

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
