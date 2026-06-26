import { sql } from 'drizzle-orm'
import { boolean, check, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * The global `users` table (migration feature F — cutover, brief 0062).
 *
 * `users` is the ONE genuinely cross-org, top-level identity record (mirroring
 * the Firestore layout where only `users` and `memberships` are top-level). It
 * is NOT a domain aggregate and NOT event-sourced: it is a CRUD doc keyed by the
 * Firebase Auth uid, written directly (upsert) on login, onboarding, profile
 * completion and LGPD anonymization — exactly as the Firestore `users/{uid}` doc
 * was. The cutover moves this last Firestore-as-database doc into Postgres so the
 * Firebase project is reduced to Auth.
 *
 * NO Row-Level Security — deliberately. Every other projection is org-scoped and
 * under `FORCE ROW LEVEL SECURITY` (org isolation). `users` has no `org_id`: it
 * is a global identity record protected at the request boundary by Firebase Auth
 * (the session cookie), exactly as the Firestore `users/{uid}` doc was guarded by
 * an `isSignedIn()`-only rule, never by org. Reads cross orgs by design (e.g.
 * `enrichCustomers` hydrates customer PII by a batch of arbitrary uids), so an
 * org-scoped RLS predicate would be wrong here. Access therefore goes through the
 * dedicated `users-store` helpers on the raw pool, NOT through `readUnderRls`.
 *
 * The domain `User` is a 3-way union (Incomplete · Complete · Anonymized) over
 * two axes (`completionCompleted`, `anonymizedAt`). The table stores the widened
 * shape (nullable PII columns) and the decode against the `User` schema on read
 * re-narrows to the only representable states. `taxIdentity` and `specialties`
 * are composite/structural state → JSONB; everything else is a scalar column.
 *
 * Invariants enforced HERE:
 *   - `uid` PRIMARY KEY (the Firebase Auth uid).
 *   - `email_verified` / `completion_completed` NOT NULL booleans (state flags).
 *   - `created_at` / `updated_at` NOT NULL.
 */
export const users = pgTable(
  'users',
  {
    // The Firebase Auth uid — the global identity key (not an aggregate path).
    uid: text('uid').primaryKey(),

    // ── Identity scalars (mirror the domain `User`) ─────────────────────────
    email: text('email'),
    displayName: text('display_name'),
    avatarUrl: text('avatar_url'),
    emailVerified: boolean('email_verified').notNull(),
    // The user's last-active org choice (no FK: an org can be deleted while the
    // user lingers; the read tolerates a dangling id).
    currentOrgId: text('current_org_id'),

    // ── PII (nullable; scrubbed to null on anonymization) ───────────────────
    whatsapp: text('whatsapp'),
    birthDate: text('birth_date'),
    bio: text('bio'),

    // ── State flags + lifecycle timestamps ──────────────────────────────────
    completionCompleted: boolean('completion_completed').notNull(),
    // Set once a Firebase Auth identity backs the doc (null on recepcionista
    // stubs). See #839.
    // timestamptz (brief 0068 D1) — mode:'string', rowToDoc normaliza pra ISO
    claimedAt: timestamp('claimed_at', { withTimezone: true, mode: 'string' }),
    termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true, mode: 'string' }),
    termsVersion: text('terms_version'),
    privacyAcceptedAt: timestamp('privacy_accepted_at', { withTimezone: true, mode: 'string' }),
    privacyVersion: text('privacy_version'),
    // LGPD art. 18 erasure timestamp (#1093). Non-null ⇒ PII scrubbed to null.
    anonymizedAt: timestamp('anonymized_at', { withTimezone: true, mode: 'string' }),

    // ── Composite / structural state (JSONB) ────────────────────────────────
    // PF/PJ identity, same shape as Org/Professional. Null until a role needs it.
    taxIdentity: jsonb('tax_identity'),
    // Professional skills surfaced on profiles.
    specialties: jsonb('specialties'),

    // timestamptz (brief 0068 D1) — mode:'string', rowToDoc normaliza pra ISO
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    // Email lookups (login dedup / support).
    index('users_email_idx').on(table.email),
    // The anonymized invariant, mirrored from the domain union: a non-null
    // `anonymized_at` REQUIRES the PII columns scrubbed to null (the only path
    // that produces a "completed account with no whatsapp").
    check(
      'users_anonymized_pii_scrubbed',
      sql`${table.anonymizedAt} IS NULL OR (${table.whatsapp} IS NULL AND ${table.birthDate} IS NULL)`,
    ),
  ],
)

export type StoredUserRow = typeof users.$inferSelect
export type NewUserRow = typeof users.$inferInsert
