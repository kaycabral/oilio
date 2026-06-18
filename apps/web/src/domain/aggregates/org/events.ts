import { StoredOrg } from '@/domain/types/org'
import { CompanyProfile } from '@/domain/types/tax'
import { Schema } from 'effect'

export const OrgCreatedSchema = Schema.Struct({
  _tag: Schema.Literal('org.created'),
  data: StoredOrg,
})

export const OrgUpdatedSchema = Schema.Struct({
  _tag: Schema.Literal('org.updated'),
  changes: Schema.partial(StoredOrg),
})

export const OrgDeletedSchema = Schema.Struct({
  _tag: Schema.Literal('org.deleted'),
})

export const OrgSelfBookingPublishedSchema = Schema.Struct({
  _tag: Schema.Literal('org.self_booking_published'),
})

export const OrgSelfBookingUnpublishedSchema = Schema.Struct({
  _tag: Schema.Literal('org.self_booking_unpublished'),
})

// Formalization (brief 0048): the informal Org becomes a `company`. The payload
// carries ONLY non-PII corporate data — the matriz CNPJ-14 (`taxId`), the
// registry `CompanyProfile`, and the `formalizedAt` boundary. Razão social /
// nome fantasia (PII) are written to the deletable `orgs/{id}/private/
// taxIdentity` doc by the action, NEVER into this immutable event (ADR 0010).
export const OrgFormalizedSchema = Schema.Struct({
  _tag: Schema.Literal('org.formalized'),
  taxId: Schema.String,
  companyProfile: CompanyProfile,
  formalizedAt: Schema.String,
})

export const OrgEventSchema = Schema.Union(
  OrgCreatedSchema,
  OrgUpdatedSchema,
  OrgDeletedSchema,
  OrgSelfBookingPublishedSchema,
  OrgSelfBookingUnpublishedSchema,
  OrgFormalizedSchema,
)

export type OrgCreated = typeof OrgCreatedSchema.Type
export type OrgUpdated = typeof OrgUpdatedSchema.Type
export type OrgDeleted = typeof OrgDeletedSchema.Type
export type OrgSelfBookingPublished = typeof OrgSelfBookingPublishedSchema.Type
export type OrgSelfBookingUnpublished = typeof OrgSelfBookingUnpublishedSchema.Type
export type OrgFormalized = typeof OrgFormalizedSchema.Type
export type OrgEvent = typeof OrgEventSchema.Type
