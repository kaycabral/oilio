import { Membership, MembershipFields } from '@/domain/types/membership'
import { Schema } from 'effect'

// `membership.created` payload schema. The canonical read model is `Membership`
// (single-unit RLS lock under the `rlsUnitScope` key — brief 0068 D4). Legacy
// events written before the rename carry the field under the old `unitId` key;
// this tolerant decode maps it onto `rlsUnitScope` so replay of historical
// streams stays safe WITHOUT an upcaster (no schemaVersion bump, no upcaster
// map — the renamed key is normalized at this single decode boundary). New
// events serialize the canonical `rlsUnitScope` key; both forms decode to the
// same `Membership`. `membership.updated` never carries the unit scope, so its
// `changes` partial needs no legacy handling.
const { rlsUnitScope: _rlsUnitScope, ...MembershipFieldsWithoutScope } = MembershipFields

const MembershipCreatedDataSchema = Schema.transform(
  Schema.Struct({
    ...MembershipFieldsWithoutScope,
    rlsUnitScope: Schema.optional(Schema.NullOr(Schema.String)),
    unitId: Schema.optional(Schema.NullOr(Schema.String)),
  }),
  Membership,
  {
    strict: false,
    decode: (input) => {
      const { unitId, rlsUnitScope, ...rest } = input
      return { ...rest, rlsUnitScope: rlsUnitScope ?? unitId ?? null }
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
