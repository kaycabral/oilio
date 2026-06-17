import { StoredUnit } from '@/domain/types/unit'
import { Schema } from 'effect'

export const UnitCreatedSchema = Schema.Struct({
  _tag: Schema.Literal('unit.created'),
  data: StoredUnit,
})

export const UnitUpdatedSchema = Schema.Struct({
  _tag: Schema.Literal('unit.updated'),
  changes: Schema.partial(StoredUnit),
})

export const UnitDeletedSchema = Schema.Struct({
  _tag: Schema.Literal('unit.deleted'),
})

export const UnitArchivedSchema = Schema.Struct({
  _tag: Schema.Literal('unit.archived'),
  archivedAt: Schema.NullOr(Schema.String),
})

export const UnitEventSchema = Schema.Union(
  UnitCreatedSchema,
  UnitUpdatedSchema,
  UnitDeletedSchema,
  UnitArchivedSchema,
)

export type UnitCreated = typeof UnitCreatedSchema.Type
export type UnitUpdated = typeof UnitUpdatedSchema.Type
export type UnitDeleted = typeof UnitDeletedSchema.Type
export type UnitArchived = typeof UnitArchivedSchema.Type
export type UnitEvent = typeof UnitEventSchema.Type
