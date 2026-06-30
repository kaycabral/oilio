import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

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
    // PF/PJ identity, same shape as Org/MemberOperation. Null until a role needs it.
    taxIdentity: jsonb('tax_identity'),
    // MemberOperation skills surfaced on profiles.
    specialties: jsonb('specialties'),

    // timestamptz (brief 0068 D1) — mode:'string', rowToDoc normaliza pra ISO
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    // Email lookups (login dedup / support).
    index('users_email_idx').on(table.email),
    // WhatsApp is GLOBALLY unique per person — a phone number has exactly one
    // owner, and the User is global (org/unit/role-agnostic), so the same number
    // can never back two Users. This is the database wall of the
    // one-owner-per-number rule (mirrored by an app-layer check that turns the
    // violation into a handled error). Partial: NULL means "no number yet"
    // (recepcionista stub / anonymized account), which is the absence of the
    // datum, not a colliding value — Postgres lets multiple NULLs coexist anyway,
    // and the WHERE makes the intent explicit.
    uniqueIndex('users_whatsapp_unique')
      .on(table.whatsapp)
      .where(sql`${table.whatsapp} IS NOT NULL`),
    // The anonymized invariant, mirrored from the domain union: a non-null
    // `anonymized_at` REQUIRES the PII columns scrubbed to null (the only path
    // that produces a "completed account with no whatsapp").
    check(
      'users_anonymized_pii_scrubbed',
      sql`${table.anonymizedAt} IS NULL OR (${table.whatsapp} IS NULL AND ${table.birthDate} IS NULL)`,
    ),
    // Complete-registration invariant (brief 0077, AC-02) — the DATABASE layer of
    // the defesa-em-3-camadas (banco + action + UI). A user who FINISHED the
    // completion step (`completion_completed = true`) MUST carry the contact
    // channel (whatsapp) and birth_date: nobody completes registration without
    // them, so nobody who logged in can linger usable with an incomplete profile
    // (the brief's origin incident — a wrong/missing number with no path to fix).
    //
    // Keyed on `completion_completed`, NOT `claimed_at` (brief AC-02 says
    // "claimed ⇒ complete", but the brief's own Fluxo principal logs the user in
    // FIRST — step 4 — and completes the profile AFTER — step 5; so claimed +
    // not-yet-completed is the legitimate transient between login and the
    // completion form, and `/api/session` creates exactly that row on first
    // login. Anchoring the CHECK on `completion_completed` is the only predicate
    // that both forbids a *usable* incomplete account and admits that transient.
    // The booking gate (#1275) refuses to act for a non-completed user, so a
    // claimed+incomplete row can never produce an appointment.)
    //
    // Anonymized accounts (`anonymized_at != null`) are carved out: the LGPD
    // erasure scrubs PII to null AFTER completion was proven, so a completed +
    // anonymized user is allowed null whatsapp/birth_date — without this the
    // erasure cascade would deadlock against this CHECK and
    // `users_anonymized_pii_scrubbed` at once.
    //
    // `whatsapp` uses non-empty (`char_length(btrim) > 0`), not `IS NOT NULL`:
    // `''` satisfies NOT NULL but is not a real contact channel, so a blank
    // whatsapp would count as "completed" (the zero-value-as-data gap, #1283).
    // `birth_date` keeps `IS NOT NULL` (it's a date column — `''` can't be stored).
    check(
      'users_completed_profile_complete',
      sql`${table.completionCompleted} = false OR ${table.anonymizedAt} IS NOT NULL OR (char_length(btrim(${table.whatsapp})) > 0 AND ${table.birthDate} IS NOT NULL)`,
    ),
  ],
)

export type StoredUserRow = typeof users.$inferSelect
export type NewUserRow = typeof users.$inferInsert
