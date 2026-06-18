import { Schema } from 'effect'

import type { WhatsappTemplates } from '../utils/whatsapp'
import { Vertical } from './enums'
import { CompanyProfile, TaxIdentity } from './tax'

// `WhatsappTemplates` (a hand-written `type` in `../utils/whatsapp`, outside the
// read-model kernel) projected as a schema so the `Org.whatsappTemplates`
// field stays a single source of truth here. The `_proof` below pins it to the
// canonical type — drift fails the build.
const WhatsappTemplatesSchema = Schema.mutable(
  Schema.Struct({
    confirmation: Schema.String,
    reminder: Schema.String,
    cancellation: Schema.String,
  }),
)
type _ProofWhatsappTemplates = [
  typeof WhatsappTemplatesSchema.Type extends WhatsappTemplates ? true : false,
  WhatsappTemplates extends typeof WhatsappTemplatesSchema.Type ? true : false,
]
const _proofWhatsappTemplates: _ProofWhatsappTemplates = [true, true]
void _proofWhatsappTemplates

export const OrgBranding = Schema.mutable(
  Schema.Struct({
    logoUrl: Schema.NullOr(Schema.String),
    bannerUrl: Schema.NullOr(Schema.String),
    description: Schema.NullOr(Schema.String),
  }),
)
export type OrgBranding = typeof OrgBranding.Type

export const ORG_DESCRIPTION_MAX = 280
export const DEFAULT_ORG_BRANDING: OrgBranding = {
  logoUrl: null,
  bannerUrl: null,
  description: null,
}

export function isValidPublicHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return false
  try {
    const u = new URL(value)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

// Narrows an unknown to an indexable record without asserting — lets the
// `normalize*` parsers read fields off untrusted input cast-free (each field is
// then guarded by its own typeof/validator check).
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function normalizeOrgBranding(raw: unknown): OrgBranding {
  if (!isRecord(raw)) return { ...DEFAULT_ORG_BRANDING }
  const r = raw
  const description =
    typeof r.description === 'string' && r.description.trim().length > 0
      ? r.description.trim().slice(0, ORG_DESCRIPTION_MAX)
      : null
  return {
    logoUrl: isValidPublicHttpUrl(r.logoUrl) ? r.logoUrl : null,
    bannerUrl: isValidPublicHttpUrl(r.bannerUrl) ? r.bannerUrl : null,
    description,
  }
}

export const SlotMinutes = Schema.Literal(5, 10, 15, 30)
export type SlotMinutes = typeof SlotMinutes.Type

export const SLOT_MINUTES_OPTIONS = [5, 10, 15, 30] as const satisfies readonly SlotMinutes[]

export function isValidSlotMinutes(v: unknown): v is SlotMinutes {
  return SLOT_MINUTES_OPTIONS.some((o) => o === v)
}

// Opt-in self-service cancellation policy. When `enabled = false`, the public
// pre-booking screen shows no policy copy and cancel/reschedule UX has zero
// friction. Tracking on Appointment is always populated regardless of this
// flag — the flag only gates customer-facing communication. Wiki:
// 04-Roadmap-Politica-Cancelamento.
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

export const Org = Schema.mutable(
  Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    slug: Schema.String,
    vertical: Vertical,
    taxIdentity: Schema.NullOr(TaxIdentity),
    // Corporate registry data from the CNPJ lookup (brief 0046). NON-PII, so —
    // unlike `taxIdentity` — it stays in `StoredOrg` and the `org.created`
    // event: queryable + replay-safe. `optional` tolerates strict-decoding docs
    // written before this field existed; populated on creation by `createOrg`.
    companyProfile: Schema.optional(Schema.NullOr(CompanyProfile)),
    ownerUserId: Schema.String,
    // Self-booking publication gate (brief 0008 #988). The public page is only
    // reachable when `selfBookingPublished` is true — the owner publishes
    // explicitly after the minimum (1 unit w/ address+hours, 1 public service,
    // 1 approved professional). Event-sourced via `org.self_booking_published`.
    selfBookingPublished: Schema.Boolean,
    selfBookingPublishedAt: Schema.optional(Schema.NullOr(Schema.String)),
    timezone: Schema.String,
    slotMinutes: SlotMinutes,
    branding: OrgBranding,
    cancellationPolicy: CancellationPolicy,
    whatsappTemplates: WhatsappTemplatesSchema,
    createdAt: Schema.String,
    updatedAt: Schema.String,
  }),
)
export type Org = typeof Org.Type

// Storage projection of `Org`: the `orgs/{id}` doc that OMITS the PII
// (taxIdentity), which lives in a deletable doc and is merged at read time.
// Decode raw `orgs` docs against this.
export const StoredOrg = Org.pipe(Schema.omit('taxIdentity'))
export type StoredOrg = typeof StoredOrg.Type

export const DEFAULT_ORG_TIMEZONE = 'America/Sao_Paulo'
export const DEFAULT_SLOT_MINUTES: SlotMinutes = 15
