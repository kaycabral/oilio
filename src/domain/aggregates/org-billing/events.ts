import { StoredOrgBilling } from '@/domain/types/org-billing'
import { Schema, Struct } from 'effect'

export const OrgBillingActivatedSchema = Schema.Struct({
  _tag: Schema.Literal('org_billing.activated'),
  data: StoredOrgBilling,
})

export const OrgBillingUpdatedSchema = Schema.Struct({
  _tag: Schema.Literal('org_billing.updated'),
  changes: StoredOrgBilling.mapFields(Struct.map(Schema.optional)),
})

export const OrgBillingCanceledSchema = Schema.Struct({
  _tag: Schema.Literal('org_billing.canceled'),
  changes: StoredOrgBilling.mapFields(Struct.map(Schema.optional)),
})

export const OrgBillingEventSchema = Schema.Union([
  OrgBillingActivatedSchema,
  OrgBillingUpdatedSchema,
  OrgBillingCanceledSchema,
])

export type OrgBillingActivated = typeof OrgBillingActivatedSchema.Type
export type OrgBillingUpdated = typeof OrgBillingUpdatedSchema.Type
export type OrgBillingCanceled = typeof OrgBillingCanceledSchema.Type
export type OrgBillingEvent = typeof OrgBillingEventSchema.Type
