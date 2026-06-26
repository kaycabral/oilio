import { StoredOrg } from '@/domain/types/org'
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

// Formalization moved to the UNIT aggregate (PRD Identidade v2 / brief 0048):
// the fiscal identity belongs to the establishment, not the Org folder. See
// `unit.formalized` in the unit aggregate. Self-booking publish moved to the
// UNIT aggregate too (PRD Identidade v2): the agenda/self-booking config is an
// establishment concern — see `unit.self_booking_published`/`unpublished`.

export const OrgEventSchema = Schema.Union(OrgCreatedSchema, OrgUpdatedSchema, OrgDeletedSchema)

export type OrgCreated = typeof OrgCreatedSchema.Type
export type OrgUpdated = typeof OrgUpdatedSchema.Type
export type OrgDeleted = typeof OrgDeletedSchema.Type
export type OrgEvent = typeof OrgEventSchema.Type
