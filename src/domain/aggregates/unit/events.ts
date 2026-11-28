import { CompanyProfile } from '@/domain/types/tax'
import { CompleteAddress, StoredUnit } from '@/domain/types/unit'
import { Schema, Struct } from 'effect'

const StoredUnitWithCompleteAddress = StoredUnit.mapFields(Struct.omit(['address'])).mapFields(
  Struct.assign({ address: CompleteAddress }),
)

export const UnitCreatedSchema = Schema.Struct({
  _tag: Schema.Literal('unit.created'),
  data: StoredUnitWithCompleteAddress,
})

export const UnitUpdatedSchema = Schema.Struct({
  _tag: Schema.Literal('unit.updated'),
  changes: StoredUnitWithCompleteAddress.mapFields(Struct.map(Schema.optional)),
})

export const UnitDeletedSchema = Schema.Struct({
  _tag: Schema.Literal('unit.deleted'),
})

export const UnitArchivedSchema = Schema.Struct({
  _tag: Schema.Literal('unit.archived'),
  archivedAt: Schema.NullOr(Schema.String),
})

export const UnitFormalizedSchema = Schema.Struct({
  _tag: Schema.Literal('unit.formalized'),
  taxId: Schema.String,
  companyProfile: CompanyProfile,
  formalizedAt: Schema.String,
})

export const UnitEventSchema = Schema.Union([
  UnitCreatedSchema,
  UnitUpdatedSchema,
  UnitDeletedSchema,
  UnitArchivedSchema,
  UnitFormalizedSchema,
])

export type UnitCreated = typeof UnitCreatedSchema.Type
export type UnitUpdated = typeof UnitUpdatedSchema.Type
export type UnitDeleted = typeof UnitDeletedSchema.Type
export type UnitArchived = typeof UnitArchivedSchema.Type
export type UnitFormalized = typeof UnitFormalizedSchema.Type
export type UnitEvent = typeof UnitEventSchema.Type
