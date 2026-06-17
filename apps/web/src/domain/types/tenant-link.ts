import { Schema } from 'effect'

// Reverse index — identity-layer graph of the establishments a data subject is
// a CUSTOMER of (brief 0032 / #1097, AC-10).
//
// Lives at `users/{uid}/tenant_links/{tenantId}` — a subcollection of the
// subject's OWN identity doc. It carries ONLY references (zero PII): the tenant
// id is the doc id and `linkedAt` is the proof timestamp. It is the
// generalization of the pattern ADR 0004 already adopts (`memberships`
// top-level): the identity↔tenant graph lives in the identity layer, so the
// subject can enumerate "where am I a customer?" by reading their OWN
// subcollection — a per-user read, NOT a cross-tenant `collectionGroup` query
// (which ADR 0004 bans). Populated as a saga step when a `customer` is created
// in any tenant + backfilled by the dev seed.
export const TenantLink = Schema.mutable(
  Schema.Struct({
    // The tenant the subject is a customer of. Mirrors the doc id (`tenantId`),
    // kept on the doc for ergonomic reads. Zero PII.
    tenantId: Schema.String,
    // ISO proof timestamp of when the link was first recorded. Reference-only.
    linkedAt: Schema.String,
  }),
)
export type TenantLink = typeof TenantLink.Type

// Relative path of a subject's reverse-index entry under their identity doc.
// Single source so the writer, reader, seed backfill and rules stay in sync.
export function tenantLinkDocPath(uid: string, tenantId: string): string {
  return `users/${uid}/tenant_links/${tenantId}`
}
