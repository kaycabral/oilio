import {
  Membership,
  MembershipFields,
  withRoleDefaultedPermissions,
} from '@/domain/types/membership'
import { Schema } from 'effect'

const {
  rlsUnitScope: _rlsUnitScope,
  permissions: _permissions,
  ...MembershipFieldsRaw
} = MembershipFields

const MembershipCreatedDataSchema = Schema.transform(
  Schema.Struct({
    ...MembershipFieldsRaw,
    rlsUnitScope: Schema.optional(Schema.NullOr(Schema.String)),
    unitId: Schema.optional(Schema.NullOr(Schema.String)),
    permissions: Schema.optional(Schema.Unknown),
  }),
  Membership,
  {
    strict: false,
    decode: (input) => {
      const { unitId, rlsUnitScope, permissions, ...rest } = input
      return {
        ...rest,
        rlsUnitScope: rlsUnitScope ?? unitId ?? null,
        permissions: withRoleDefaultedPermissions(rest.role, permissions),
      }
    },
    encode: (membership) => ({ ...membership }),
  },
)

export const MembershipCreatedSchema = Schema.Struct({
  _tag: Schema.Literal('membership.created'),
  data: MembershipCreatedDataSchema,
})

export const MembershipUpdatedSchema = Schema.Struct({
  _tag: Schema.Literal('membership.updated'),
  changes: Schema.partial(Membership),
})

export const MembershipDeletedSchema = Schema.Struct({
  _tag: Schema.Literal('membership.deleted'),
})

export const MembershipEventSchema = Schema.Union(
  MembershipCreatedSchema,
  MembershipUpdatedSchema,
  MembershipDeletedSchema,
)

export type MembershipCreated = typeof MembershipCreatedSchema.Type
export type MembershipUpdated = typeof MembershipUpdatedSchema.Type
export type MembershipDeleted = typeof MembershipDeletedSchema.Type
export type MembershipEvent = typeof MembershipEventSchema.Type
