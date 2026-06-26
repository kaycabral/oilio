import { Schema } from 'effect'

// Reverse index — identity-layer graph of the establishments a data subject is
// a CUSTOMER of (brief 0032 / #1097, AC-10).
//
// Lives at `users/{uid}/org_links/{orgId}` — a subcollection of the
// subject's OWN identity doc. It carries ONLY references (zero PII): the org
// id is the doc id and `linkedAt` is the proof timestamp. It is the
// generalization of the pattern ADR 0004 already adopts (`memberships`
// top-level): the identity↔org graph lives in the identity layer, so the
// subject can enumerate "where am I a customer?" by reading their OWN
// subcollection — a per-user read, NOT a cross-org `collectionGroup` query
// (which ADR 0004 bans). Populated as a saga step when a `customer` is created
// in any org + backfilled by the dev seed.
export const OrgLink = Schema.mutable(
  Schema.Struct({
    // The org the subject is a customer of. Mirrors the doc id (`orgId`),
    // kept on the doc for ergonomic reads. Zero PII.
    orgId: Schema.String,
    // ISO proof timestamp of when the link was first recorded. Reference-only.
    linkedAt: Schema.String,
  }),
)
export type OrgLink = typeof OrgLink.Type

// Relative path of a subject's reverse-index entry under their identity doc.
// Single source so the writer, reader, seed backfill and rules stay in sync.
export function orgLinkDocPath(uid: string, orgId: string): string {
  return `users/${uid}/org_links/${orgId}`
}
