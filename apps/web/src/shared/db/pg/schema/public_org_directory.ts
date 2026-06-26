import { index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * The PUBLIC org directory (migration feature F — cutover, brief 0062). The
 * tenant directory that the pre-auth public booking page resolves `slug → org`
 * against — the ONE read that has no org context yet (it is resolving WHICH org).
 *
 * This is a deliberate separation of concerns (the "excellence" design over a
 * raw RLS hole on `orgs`): instead of poking a public-read exception into the
 * org-scoped `orgs` table, the cutover materializes a SECOND, intentionally
 * PUBLIC projection carrying ONLY the fields the public booking surface needs —
 * `slug`, `name`, `branding`, plus the `org_id` (the resolution target) and the
 * `owner_user_id`/`vertical`/`website` needed to reconstruct the public `Org`
 * read-model without a second hop. No customer/operational/financial data ever
 * lands here. The intent ("what is public?") lives in the SCHEMA, not in a GUC.
 *
 * Fed by the SAME `org` event as the org-scoped `orgs` projection (the org
 * projector writes both rows in one transaction), so it can never drift. Keyed
 * by `org_id`; the unique `slug` index powers the slug → org lookup.
 *
 * NO Row-Level Security — public by contract. The booking page is public to the
 * internet exactly as it was under the Firestore rules (slug resolution was an
 * unauthenticated read). The table is also cacheable at the edge (ISR/CDN)
 * because its rows are public and change rarely.
 */
export const publicOrgDirectory = pgTable(
  'public_org_directory',
  {
    orgId: text('org_id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    vertical: text('vertical').notNull(),
    website: text('website'),
    ownerUserId: text('owner_user_id').notNull(),
    branding: jsonb('branding').notNull(),
    // timestamptz (brief 0068 D1) — mode:'string', rowToDoc normaliza pra ISO
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    // The public slug → org resolution (the one pre-auth read).
    index('public_org_directory_slug_idx').on(table.slug),
  ],
)

export type StoredPublicOrgDirectoryRow = typeof publicOrgDirectory.$inferSelect
export type NewPublicOrgDirectoryRow = typeof publicOrgDirectory.$inferInsert
