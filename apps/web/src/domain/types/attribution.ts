import { Schema } from 'effect'

// Multi-axis acquisition attribution (brief 0077, Grupo D — AC-10..13). Replaces
// the single `via` of [[0001]] (which only ever travelled as a log argument, never
// a column — greenfield, no data to migrate). The axes are orthogonal UTM-style
// dimensions so the owner can answer "which channel / which campaign brought this
// client" without a parallel spreadsheet:
//
//   - source   WHERE it came from   (qr | whatsapp | link | direct | …)
//   - medium   the channel kind     (invite | organic | campaign | …)
//   - campaign named campaign        (free slug, optional)
//   - content  creative / placement  (optional)
//   - term     keyword              (optional)
//   - actor    who issued it         (the establishment uid for an invite, or null
//                                     for a self-arriving visitor)
//   - intent   what the link is for  (signup | booking)
//
// Persisted in TWO places with different lifetimes (AC-11):
//   - Customer  → ACQUISITION, write-once: the first touch that created the
//                 relationship. Never overwritten by a later visit.
//   - Appointment → TOUCH: the attribution of THIS booking. Every appointment
//                 records its own, so a returning client booking via another
//                 channel is captured without clobbering acquisition.
//
// PII-zero: attribution carries channel + ids only, never a name/phone/email — it
// is safe to put in `track()` event payloads (the parede PII↔analytics, AC-12).

export const ATTRIBUTION_INTENTS = ['signup', 'booking'] as const
export const AttributionIntent = Schema.Literal(...ATTRIBUTION_INTENTS)
export type AttributionIntent = typeof AttributionIntent.Type

export const Attribution = Schema.mutable(
  Schema.Struct({
    source: Schema.NullOr(Schema.String),
    medium: Schema.NullOr(Schema.String),
    campaign: Schema.NullOr(Schema.String),
    content: Schema.NullOr(Schema.String),
    term: Schema.NullOr(Schema.String),
    // The establishment actor (uid) who issued an invite; null for a visitor who
    // arrived on their own (organic / direct).
    actorId: Schema.NullOr(Schema.String),
    intent: AttributionIntent,
  }),
)
export type Attribution = typeof Attribution.Type

// The URL query-param names that carry attribution on a contextual link/QR. The
// `cbrl_` namespace avoids colliding with a host's own `utm_*` (which a campaign
// tool may append) while staying recognizable. The capture path reads BOTH this
// namespace and the standard `utm_*` aliases (see `attributionFromParams`).
export const ATTRIBUTION_PARAM = {
  source: 'cbrl_source',
  medium: 'cbrl_medium',
  campaign: 'cbrl_campaign',
  content: 'cbrl_content',
  term: 'cbrl_term',
  actorId: 'cbrl_actor',
  intent: 'cbrl_intent',
} as const

// Standard UTM aliases accepted on the capture side (AC-13 — UTM from a URL).
const UTM_ALIAS = {
  source: 'utm_source',
  medium: 'utm_medium',
  campaign: 'utm_campaign',
  content: 'utm_content',
  term: 'utm_term',
} as const

// Hard ceiling per axis (AC-13 length cap). Long enough for real campaign slugs,
// short enough that a tampered URL can't bloat a row or an event payload.
export const ATTRIBUTION_MAX_LEN = 64

// Allowlist for a single axis value (AC-13 sanitization): lowercase letters,
// digits, and the separators a slug/UTM legitimately uses. Anything else (spaces,
// punctuation, unicode, injection chars) is stripped — never stored raw. An empty
// result becomes null (absent), not "".
export function sanitizeAttributionValue(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, ATTRIBUTION_MAX_LEN)
  return cleaned.length > 0 ? cleaned : null
}

// The `actorId` axis holds a uid (mixed case, longer charset) — sanitize more
// permissively than a slug but still cap length and strip anything that isn't a
// plausible id character, so a tampered `cbrl_actor` can't smuggle markup.
function sanitizeActorId(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const cleaned = raw
    .trim()
    .replace(/[^A-Za-z0-9._:-]/g, '')
    .slice(0, ATTRIBUTION_MAX_LEN)
  return cleaned.length > 0 ? cleaned : null
}

function coerceIntent(raw: string | null | undefined): AttributionIntent {
  return raw === 'booking' ? 'booking' : 'signup'
}

// Read attribution from a flat param bag (a URLSearchParams-like record), applying
// the same sanitization the persistence path relies on. Accepts the `cbrl_*`
// namespace first, then falls back to the standard `utm_*` alias for the five UTM
// axes — so a campaign tool's `utm_source=...` is captured too (AC-13). Backend is
// the authority: this is the single sanitizing boundary, never a raw passthrough.
export function attributionFromParams(
  read: (key: string) => string | null | undefined,
): Attribution {
  const axis = (key: keyof typeof UTM_ALIAS): string | null =>
    sanitizeAttributionValue(read(ATTRIBUTION_PARAM[key]) ?? read(UTM_ALIAS[key]))
  return {
    source: axis('source'),
    medium: axis('medium'),
    campaign: axis('campaign'),
    content: axis('content'),
    term: axis('term'),
    actorId: sanitizeActorId(read(ATTRIBUTION_PARAM.actorId)),
    intent: coerceIntent(read(ATTRIBUTION_PARAM.intent)),
  }
}

// Serialize attribution into URLSearchParams entries (only the non-null axes +
// always the intent), for building a contextual invite link/QR. Values are
// sanitized on the way out too, so a malformed campaign passed by an operator
// never produces a malformed link.
export function attributionToSearchParams(attribution: Attribution): URLSearchParams {
  const params = new URLSearchParams()
  const put = (key: keyof typeof ATTRIBUTION_PARAM, value: string | null): void => {
    if (value != null && value.length > 0) params.set(ATTRIBUTION_PARAM[key], value)
  }
  put('source', sanitizeAttributionValue(attribution.source))
  put('medium', sanitizeAttributionValue(attribution.medium))
  put('campaign', sanitizeAttributionValue(attribution.campaign))
  put('content', sanitizeAttributionValue(attribution.content))
  put('term', sanitizeAttributionValue(attribution.term))
  put('actorId', sanitizeActorId(attribution.actorId))
  params.set(ATTRIBUTION_PARAM.intent, attribution.intent)
  return params
}

// PII-zero projection for a `track()` event payload (AC-12). Identical shape today
// (attribution is already PII-free by construction), but kept as the explicit
// boundary the event emitters call — so if an axis ever gained a freer charset the
// wall has one place to enforce.
export function attributionForEvent(attribution: Attribution): {
  source: string | null
  medium: string | null
  campaign: string | null
} {
  return {
    source: attribution.source,
    medium: attribution.medium,
    campaign: attribution.campaign,
  }
}
