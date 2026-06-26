import { Schema } from 'effect'

import { Vertical } from './enums'

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

// The Org is a pure folder/shell (PRD Identidade v2): name, slug, segment
// (= vertical), branding, website, ownerUserId, timestamps. It carries NO
// fiscal identity (the CNPJ is the establishment's — `Unit.fiscal`, brief 0048)
// and NO agenda/self-booking config (timezone, slotMinutes, cancellationPolicy,
// confirmation messages, self-booking publish state all moved to `Unit.agenda`
// — they're establishment/agenda concerns of the Unit, not the folder).
export const Org = Schema.mutable(
  Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    slug: Schema.String,
    vertical: Vertical,
    // The brand's site/domain (optional). Future: domain verification + Google
    // Shopping (PRD Identidade § Contrato de tipagem — Org ganha `website`).
    website: Schema.optional(Schema.NullOr(Schema.String)),
    ownerUserId: Schema.String,
    branding: OrgBranding,
    createdAt: Schema.String,
    updatedAt: Schema.String,
  }),
)
export type Org = typeof Org.Type

// Storage projection of `Org`: the `orgs/{id}` doc. The Org has NO fiscal PII
// anymore (PRD Identidade v2 — the fiscal identity moved to `Unit.fiscal`) and
// no agenda config (moved to `Unit.agenda`), so the stored shape equals the
// read model. `name` is the BUSINESS name (not titular PII) and stays on the
// doc. Decode raw `orgs` docs against this.
export const StoredOrg = Org
export type StoredOrg = typeof StoredOrg.Type
