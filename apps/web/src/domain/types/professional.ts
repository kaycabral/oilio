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
    // Approval to operate (take bookings, show on agenda, receive split).
    operationalStatus: OperationalStatus,
    defaultCommission: Schema.NullOr(CommissionRule),
    unitIds: Schema.mutable(Schema.Array(Schema.String)),
    // Subset dos serviços do org que esse profissional executa — FKs em
    // `catalog_items` de kind service (brief 0023, #1004; era a coleção legada
    // `services`). Invariante server-side: cada id precisa de
    // `CatalogItem.unitIds ∩ Professional.unitIds ≠ ∅`. Vazio = não executa
    // nenhum serviço ainda (estado válido na criação; sem ele o calendário
    // público filtra esse pro). Ver #876.
    serviceIds: Schema.mutable(Schema.Array(Schema.String)),
    createdAt: Schema.String,
    updatedAt: Schema.String,
  }),
)
export type Professional = typeof Professional.Type

// Storage projection of `Professional`: the per-org `professionals/{id}` doc
// that OMITS the PII (name/whatsapp/email/taxIdentity) materialized from
// `users/` at read time. Decode raw `professionals` docs against this.
export const StoredProfessional = Professional.pipe(
  Schema.omit('name', 'whatsapp', 'email', 'taxIdentity'),
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
  return professionals.filter((p) => p.serviceIds.includes(serviceId) && p.unitIds.includes(unitId))
}
