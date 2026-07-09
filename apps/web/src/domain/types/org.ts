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

export const Org = Schema.mutable(
  Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    slug: Schema.String,
    vertical: Vertical,
    website: Schema.optional(Schema.NullOr(Schema.String)),
    ownerUserId: Schema.String,
    branding: OrgBranding,
    createdAt: Schema.String,
    updatedAt: Schema.String,
  }),
)
export type Org = typeof Org.Type

export const StoredOrg = Org
export type StoredOrg = typeof StoredOrg.Type
