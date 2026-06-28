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

export const MemberOperation = Schema.mutable(
  Schema.Struct({
    id: Schema.String,
    orgId: Schema.String,
    // Non-null (#1045 / brief 0028 AC-01). A MemberOperation is the operational
    // projection of a `Membership(role=memberOperation)` + `User`, born only from
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
    // 0068 D4 / #1226 AC-02). Present on the enriched read model `MemberOperation`
    // (the read layer attaches it); ABSENT from `StoredMemberOperation` (the event
    // payload + projection row), which omits it below.
    operationalStatus: OperationalStatus,
    defaultCommission: Schema.NullOr(CommissionRule),
    unitIds: Schema.mutable(Schema.Array(Schema.String)),
    // Subset dos serviços do org que esse profissional executa — FKs em
    // `catalog_items` de kind service (brief 0023, #1004; era a coleção legada
    // `services`). Invariante server-side: cada id precisa de
    // `CatalogItem.unitIds ∩ MemberOperation.unitIds ≠ ∅`. Vazio = não executa
    // nenhum serviço ainda (estado válido na criação; sem ele o calendário
    // público filtra esse pro). Ver #876.
    catalogServiceIds: Schema.mutable(Schema.Array(Schema.String)),
    createdAt: Schema.String,
    updatedAt: Schema.String,
  }),
)
export type MemberOperation = typeof MemberOperation.Type

// The `BookableProfessional` brand was RETIRED in brief 0076 (AC-03). "Bookable"
// is no longer a compile-time checkpoint papering over a divergent DB state — it
// is now a DB + capability invariant: the operational profile hangs off the
// membership via a composite FK (#1260), and "appears on the agenda" is read as
// the membership's `canBeBooked` capability ∧ derived readiness
// (`listBookableMemberOperationsForOrg`). No runtime brand to mint; the agenda
// consumes a plain `MemberOperation[]` filtered by that invariant.

// Storage projection of `MemberOperation`: the per-org `memberOperations/{id}` doc
// that OMITS the PII (name/whatsapp/email/taxIdentity) materialized from
// `users/` at read time, AND `operationalStatus` — which is derived on read,
// not stored (brief 0068 D4 / #1226 AC-02). Decode raw `memberOperations` docs
// against this.
export const StoredMemberOperation = MemberOperation.pipe(
  Schema.omit('name', 'whatsapp', 'email', 'taxIdentity', 'operationalStatus'),
)
export type StoredMemberOperation = typeof StoredMemberOperation.Type

// The deletable `member_operations_pii/{id}` doc. Only `taxIdentity` is per-org
// PII stored here; name/whatsapp/email are read live from `users/{userId}`.
// Picked from the same base so it can't drift from `MemberOperation`.
export const MemberOperationPii = MemberOperation.pipe(Schema.pick('taxIdentity'))
export type MemberOperationPii = typeof MemberOperationPii.Type

// Returns the subset of `memberOperations` that execute `serviceId` AND
// operate at `unitId`. Pure helper used by the public calendar (#842) and
// catalog filter (#841) — keeps unit-scoping consistent across surfaces.
export function memberOperationsForService(
  memberOperations: MemberOperation[],
  serviceId: string,
  unitId: string,
): MemberOperation[] {
  return memberOperations.filter(
    (p) => p.catalogServiceIds.includes(serviceId) && p.unitIds.includes(unitId),
  )
}
