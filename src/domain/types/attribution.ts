import { Schema, Struct } from 'effect'

export const ATTRIBUTION_INTENTS = ['signup', 'booking'] as const
export const AttributionIntent = Schema.Literals(ATTRIBUTION_INTENTS)
export type AttributionIntent = typeof AttributionIntent.Type

export const Attribution = Schema.Struct({
  source: Schema.NullOr(Schema.String),
  medium: Schema.NullOr(Schema.String),
  campaign: Schema.NullOr(Schema.String),
  content: Schema.NullOr(Schema.String),
  term: Schema.NullOr(Schema.String),
  actorId: Schema.NullOr(Schema.String),
  intent: AttributionIntent,
}).mapFields(Struct.map(Schema.mutableKey))
export type Attribution = typeof Attribution.Type

export const ATTRIBUTION_PARAM = {
  source: 'utm_source',
  medium: 'utm_medium',
  campaign: 'utm_campaign',
  content: 'utm_content',
  term: 'utm_term',
  actorId: 'cbrl_actor',
  intent: 'cbrl_intent',
} as const

const LEGACY_ALIAS = {
  source: 'cbrl_source',
  medium: 'cbrl_medium',
  campaign: 'cbrl_campaign',
  content: 'cbrl_content',
  term: 'cbrl_term',
} as const

export const ATTRIBUTION_MAX_LEN = 64

export function sanitizeAttributionValue(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, ATTRIBUTION_MAX_LEN)
  return cleaned.length > 0 ? cleaned : null
}

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

export function attributionFromParams(
  read: (key: string) => string | null | undefined,
): Attribution {
  const axis = (key: keyof typeof LEGACY_ALIAS): string | null =>
    sanitizeAttributionValue(read(ATTRIBUTION_PARAM[key]) ?? read(LEGACY_ALIAS[key]))
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
