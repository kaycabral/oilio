import { CompanyProfile } from '@/domain/types/tax'
import { CompleteAddress, StoredUnit } from '@/domain/types/unit'
import { Schema } from 'effect'

// `StoredUnit` with the address tightened to `CompleteAddress` (#1283 / brief
// 0078 AC-05): a PERSISTED unit must carry a real address, so the event decode
// rejects a blank one. The base `StoredUnit.address` stays permissive for the
// aggregate's INITIAL zero-value (`EMPTY_ADDRESS`, pre-`unit.created`).
const StoredUnitWithCompleteAddress = Schema.extend(
  StoredUnit.pipe(Schema.omit('address')),
  Schema.Struct({ address: CompleteAddress }),
)

export const UnitCreatedSchema = Schema.Struct({
  _tag: Schema.Literal('unit.created'),
  data: StoredUnitWithCompleteAddress,
})

export const UnitUpdatedSchema = Schema.Struct({
  _tag: Schema.Literal('unit.updated'),
  // `address` (when present in a partial update) must still be complete — you
  // can't edit a unit INTO a blank address.
  changes: Schema.partial(StoredUnitWithCompleteAddress),
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

// Self-booking publication is NOT event-sourced (PRD Identidade v2 / SPIKE
// "inferred availability"): a unit's public page is live the moment it is in
// appointment mode with a complete address + hours (`isUnitPubliclyLive`), with
// no stored publish flag and no publish/unpublish event. The booking mode itself
// is carried by `unit.updated` (the agenda config).

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
