import { index, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * The identity-layer reverse index `org_links` (migration feature F — cutover,
 * brief 0062). Records which orgs a data subject is a CUSTOMER of (brief 0032 /
 * #1097, AC-10) — the generalization of the top-level `memberships` pattern
 * (ADR 0004): the identity↔org graph lives in the identity layer, so "where am I
 * a customer?" is a per-user read, never a banned cross-org `collectionGroup`.
 *
 * Mirrors the Firestore `users/{uid}/org_links/{orgId}` subcollection: keyed by
 * the composite `(user_id, org_id)`, holding ONLY references (zero PII) — the
 * org id and `linked_at`. Idempotent link (re-linking the same pair is a no-op).
 *
 * NO org-scoped Row-Level Security — like `users`, this is a per-SUBJECT identity
 * record, not org-scoped operational data. The reads are per-user
 * (`listLinkedOrgIds` / `isLinkedToOrg`) and the writes are server-only (admin
 * path); the request boundary authenticates the subject. An org-scoped RLS
 * predicate would be wrong (the read is "my links across orgs", not "this org's
 * data"). Access goes through the `org-links` helpers on the raw pool.
 *
 * Invariants enforced HERE:
 *   - composite PK `(user_id, org_id)` — a user links to an org at most once.
 *   - `linked_at` NOT NULL.
 */
export const orgLinks = pgTable(
  'org_links',
  {
    userId: text('user_id').notNull(),
    orgId: text('org_id').notNull(),
    linkedAt: timestamp('linked_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    primaryKey({ name: 'org_links_pkey', columns: [table.userId, table.orgId] }),
    // Per-user reverse-index reads (`listLinkedOrgIds`).
    index('org_links_user_id_idx').on(table.userId),
  ],
)

export type StoredOrgLinkRow = typeof orgLinks.$inferSelect
export type NewOrgLinkRow = typeof orgLinks.$inferInsert
