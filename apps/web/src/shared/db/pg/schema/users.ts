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

export const users = pgTable(
  'users',
  {
    uid: text('uid').primaryKey(),

    email: text('email'),
    displayName: text('display_name'),
    avatarUrl: text('avatar_url'),
    emailVerified: boolean('email_verified').notNull(),
    currentOrgId: text('current_org_id'),

    mobile: text('mobile'),
    birthDate: text('birth_date'),
    bio: text('bio'),

    completionCompleted: boolean('completion_completed').notNull(),
    claimedAt: timestamp('claimed_at', { withTimezone: true, mode: 'string' }),
    termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true, mode: 'string' }),
    termsVersion: text('terms_version'),
    privacyAcceptedAt: timestamp('privacy_accepted_at', { withTimezone: true, mode: 'string' }),
    privacyVersion: text('privacy_version'),
    anonymizedAt: timestamp('anonymized_at', { withTimezone: true, mode: 'string' }),

    taxIdentity: jsonb('tax_identity'),
    specialties: jsonb('specialties'),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (table) => [
    index('users_email_idx').on(table.email),
    uniqueIndex('users_mobile_unique')
      .on(table.mobile)
      .where(sql`${table.mobile} IS NOT NULL`),
    check(
      'users_anonymized_pii_scrubbed',
      sql`${table.anonymizedAt} IS NULL OR (${table.mobile} IS NULL AND ${table.birthDate} IS NULL)`,
    ),
    check(
      'users_completed_profile_complete',
      sql`${table.completionCompleted} = false OR ${table.anonymizedAt} IS NOT NULL OR (${table.mobile} IS NOT NULL AND char_length(btrim(${table.mobile})) > 0 AND ${table.birthDate} IS NOT NULL)`,
    ),
    check(
      'users_mobile_br_format',
      sql`${table.mobile} IS NULL OR ${table.mobile} ~ '^55[0-9]{2}9[0-9]{8}$'`,
    ),
  ],
)

export type StoredUserRow = typeof users.$inferSelect
export type NewUserRow = typeof users.$inferInsert
