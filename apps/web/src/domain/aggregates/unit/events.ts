import { CompanyProfile } from '@/domain/types/tax'
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

// Formalization (brief 0048): the informal Unit becomes a `company`. The payload
// carries ONLY non-PII corporate data — the establishment's CNPJ-14 (`taxId`),
// the registry `CompanyProfile`, and the `formalizedAt` boundary. Razão social /
// nome fantasia (PII) are written to the deletable
// `orgs/{orgId}/units/{unitId}/private/taxIdentity` doc by the action, NEVER
// into this immutable event (ADR 0010). Matriz/filial/raiz are DERIVED from the
// CNPJ-14 on read — never carried here.
export const UnitFormalizedSchema = Schema.Struct({
  _tag: Schema.Literal('unit.formalized'),
  taxId: Schema.String,
  companyProfile: CompanyProfile,
  formalizedAt: Schema.String,
})

export const UnitEventSchema = Schema.Union(
  UnitCreatedSchema,
  UnitUpdatedSchema,
  UnitDeletedSchema,
  UnitArchivedSchema,
  UnitFormalizedSchema,
)

export type UnitCreated = typeof UnitCreatedSchema.Type
export type UnitUpdated = typeof UnitUpdatedSchema.Type
export type UnitDeleted = typeof UnitDeletedSchema.Type
export type UnitArchived = typeof UnitArchivedSchema.Type
export type UnitFormalized = typeof UnitFormalizedSchema.Type
export type UnitEvent = typeof UnitEventSchema.Type
