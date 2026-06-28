import { Schema } from 'effect'

import { OperationalStatus } from './enums'
import { TaxIdentity } from './tax'

export const CommissionRule = Schema.mutable(
  Schema.Struct({
    kind: Schema.Literal('percentage', 'fixed'),
    value: Schema.Number,
  }),
)
export type CommissionRule = typeof CommissionRule.Type

export const Professional = Schema.mutable(
  Schema.Struct({
    id: Schema.String,
    orgId: Schema.String,
    // Non-null (#1045 / brief 0028 AC-01). A Professional is the operational
    // projection of a `Membership(role=professional)` + `User`, born only from
    // the invite-acceptance saga — never a standalone entity with a null link.
    userId: Schema.String,
    name: Schema.String,
    // Canonical contact channel (#822). Stored normalized via
    // `normalizeBrazilPhone`. Required.
    whatsapp: Schema.String,
    // Optional second channel (usually populated from the OAuth provider on
    // the first session via the completion step). null when absent.
    email: Schema.NullOr(Schema.String),
    taxIdentity: Schema.NullOr(TaxIdentity),
    // Readiness to operate (take bookings, show on agenda, receive split).
    // DERIVED on read from real facts (whatsapp present ∧ ≥1 unit ∧ ≥1 service)
    // — see `deriveOperationalStatus` — NOT materialized on the projection (brief
    // 0068 D4 / #1226 AC-02). Present on the enriched read model `Professional`
    // (the read layer attaches it); ABSENT from `StoredProfessional` (the event
    // payload + projection row), which omits it below.
    operationalStatus: OperationalStatus,
    defaultCommission: Schema.NullOr(CommissionRule),
    unitIds: Schema.mutable(Schema.Array(Schema.String)),
    // Subset dos serviços do org que esse profissional executa — FKs em
    // `catalog_items` de kind service (brief 0023, #1004; era a coleção legada
    // `services`). Invariante server-side: cada id precisa de
    // `CatalogItem.unitIds ∩ Professional.unitIds ≠ ∅`. Vazio = não executa
    // nenhum serviço ainda (estado válido na criação; sem ele o calendário
    // público filtra esse pro). Ver #876.
    catalogServiceIds: Schema.mutable(Schema.Array(Schema.String)),
    createdAt: Schema.String,
    updatedAt: Schema.String,
  }),
)
export type Professional = typeof Professional.Type

// A `Professional` proven BOOKABLE: operational AND backed by an active
// membership whose role is still `professional`. The `professionals` projection
// and the membership role can diverge (a demoted member keeps a lingering
// projection row for reversibility — see role-edit-lifecycle; a seed/migration
// could insert one for a non-professional), and the agenda read trusted the row
// alone, so a receptionist or a demoted member leaked onto the grid. This brand
// is a COMPILE-TIME checkpoint: operational surfaces (agenda columns) require
// `BookableProfessional[]`, so the raw `listProfessionalsForOrg` result can't be
// handed to them by mistake — only the cross-checked read path mints the brand.
// It does NOT prevent the divergent DB state (TS sees shapes, not rows); the
// integration test proves the runtime filter, and a composite FK is a tracked
// follow-up. Effect `Schema.brand` (not a bare `unique symbol`) so callers/tests
// mint it via `BookableProfessional.make(...)` with no `as` escape hatch.
export const BookableProfessional = Professional.pipe(Schema.brand('BookableProfessional'))
export type BookableProfessional = typeof BookableProfessional.Type

// Storage projection of `Professional`: the per-org `professionals/{id}` doc
// that OMITS the PII (name/whatsapp/email/taxIdentity) materialized from
// `users/` at read time, AND `operationalStatus` — which is derived on read,
// not stored (brief 0068 D4 / #1226 AC-02). Decode raw `professionals` docs
// against this.
export const StoredProfessional = Professional.pipe(
  Schema.omit('name', 'whatsapp', 'email', 'taxIdentity', 'operationalStatus'),
)
export type StoredProfessional = typeof StoredProfessional.Type

// The deletable `professionals_pii/{id}` doc. Only `taxIdentity` is per-org
// PII stored here; name/whatsapp/email are read live from `users/{userId}`.
// Picked from the same base so it can't drift from `Professional`.
export const ProfessionalPii = Professional.pipe(Schema.pick('taxIdentity'))
export type ProfessionalPii = typeof ProfessionalPii.Type

// Returns the subset of `professionals` that execute `serviceId` AND
// operate at `unitId`. Pure helper used by the public calendar (#842) and
// catalog filter (#841) — keeps unit-scoping consistent across surfaces.
export function professionalsForService(
  professionals: Professional[],
  serviceId: string,
  unitId: string,
): Professional[] {
  return professionals.filter(
    (p) => p.catalogServiceIds.includes(serviceId) && p.unitIds.includes(unitId),
  )
}
