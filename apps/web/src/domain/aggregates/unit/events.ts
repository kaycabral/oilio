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

// Self-booking publication (brief 0008 #988), moved Org→Unit (PRD Identidade
// v2): the public page is a per-unit, appointment-agenda concern. The publish
// state lives in the `appointment` variant of `Unit.agenda`; these events only
// have effect on an appointment-mode unit (the reducer guards it).
export const UnitSelfBookingPublishedSchema = Schema.Struct({
  _tag: Schema.Literal('unit.self_booking_published'),
})

export const UnitSelfBookingUnpublishedSchema = Schema.Struct({
  _tag: Schema.Literal('unit.self_booking_unpublished'),
})

export const UnitEventSchema = Schema.Union(
  UnitCreatedSchema,
  UnitUpdatedSchema,
  UnitDeletedSchema,
  UnitArchivedSchema,
  UnitFormalizedSchema,
  UnitSelfBookingPublishedSchema,
  UnitSelfBookingUnpublishedSchema,
)

export type UnitCreated = typeof UnitCreatedSchema.Type
export type UnitUpdated = typeof UnitUpdatedSchema.Type
export type UnitDeleted = typeof UnitDeletedSchema.Type
export type UnitArchived = typeof UnitArchivedSchema.Type
export type UnitFormalized = typeof UnitFormalizedSchema.Type
export type UnitSelfBookingPublished = typeof UnitSelfBookingPublishedSchema.Type
export type UnitSelfBookingUnpublished = typeof UnitSelfBookingUnpublishedSchema.Type
export type UnitEvent = typeof UnitEventSchema.Type
