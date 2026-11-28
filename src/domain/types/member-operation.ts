import { Schema, Struct } from 'effect'

import { OperationalStatus } from './enums'
import { TaxIdentity } from './tax'

export const CommissionRule = Schema.Struct({
  kind: Schema.Literals(['percentage', 'fixed']),
  value: Schema.Number,
}).mapFields(Struct.map(Schema.mutableKey))
export type CommissionRule = typeof CommissionRule.Type

export const MemberOperation = Schema.Struct({
  id: Schema.String,
  orgId: Schema.String,
  userId: Schema.String,
  name: Schema.String,
  mobile: Schema.String,
  email: Schema.NullOr(Schema.String),
  taxIdentity: Schema.NullOr(TaxIdentity),
  operationalStatus: OperationalStatus,
  defaultCommission: Schema.NullOr(CommissionRule),
  unitIds: Schema.mutable(Schema.Array(Schema.String)),
  catalogServiceIds: Schema.mutable(Schema.Array(Schema.String)),
  createdAt: Schema.String,
  updatedAt: Schema.String,
}).mapFields(Struct.map(Schema.mutableKey))
export type MemberOperation = typeof MemberOperation.Type

export const StoredMemberOperation = MemberOperation.mapFields(
  Struct.omit(['name', 'mobile', 'email', 'taxIdentity', 'operationalStatus']),
)
export type StoredMemberOperation = typeof StoredMemberOperation.Type

export const MemberOperationPii = MemberOperation.mapFields(Struct.pick(['taxIdentity']))
export type MemberOperationPii = typeof MemberOperationPii.Type

export function memberOperationsForService(
  memberOperations: MemberOperation[],
  serviceId: string,
  unitId: string,
): MemberOperation[] {
  return memberOperations.filter(
    (p) => p.catalogServiceIds.includes(serviceId) && p.unitIds.includes(unitId),
  )
}
