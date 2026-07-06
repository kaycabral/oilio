import {
  Membership,
  MembershipFields,
  withRoleDefaultedPermissions,
} from '@/domain/types/membership'
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
// Drop `rlsUnitScope` (re-added tolerantly below) AND `permissions` from the
// source field map: `permissions` is decoded RAW here (as an unknown record) so
// the role-aware capability backfill can run on the persisted keys BEFORE the
// `MembershipPermissions` schema fills its role-blind default (#1377). Decoding
// it strictly in the source would eagerly default `canManageBilling: false`,
// masking absence and stripping billing from a legacy owner on replay.
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
        // Backfill absent capabilities from the role default so a legacy
        // membership event (written before a capability key existed) replays to
        // the role-correct permission set — a legacy owner keeps billing (#1377).
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
