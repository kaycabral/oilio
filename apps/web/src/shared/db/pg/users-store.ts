import { User } from '@/domain'
import { Schema } from 'effect'
import type { QueryResultRow } from 'pg'
import { getEventStorePool } from './pool'

const decodeUser = Schema.decodeUnknownSync(User)

export type UserRow = {
  uid: string
  email: string | null
  display_name: string | null
  avatar_url: string | null
  email_verified: boolean
  current_org_id: string | null
  mobile: string | null
  birth_date: string | null
  bio: string | null
  completion_completed: boolean
  claimed_at: string | null
  terms_accepted_at: string | null
  terms_version: string | null
  privacy_accepted_at: string | null
  privacy_version: string | null
  anonymized_at: string | null
  tax_identity: unknown
  specialties: unknown
  created_at: string
  updated_at: string
}

export function rowToUser(row: UserRow): User {
  return decodeUser({
    uid: row.uid,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    emailVerified: row.email_verified,
    currentOrgId: row.current_org_id,
    mobile: row.mobile,
    birthDate: row.birth_date,
    bio: row.bio,
    specialties: row.specialties ?? null,
    taxIdentity: row.tax_identity ?? null,
    completionCompleted: row.completion_completed,
    claimedAt: row.claimed_at == null ? null : new Date(row.claimed_at).toISOString(),
    termsAcceptedAt:
      row.terms_accepted_at == null ? null : new Date(row.terms_accepted_at).toISOString(),
    termsVersion: row.terms_version,
    privacyAcceptedAt:
      row.privacy_accepted_at == null ? null : new Date(row.privacy_accepted_at).toISOString(),
    privacyVersion: row.privacy_version,
    anonymizedAt: row.anonymized_at == null ? null : new Date(row.anonymized_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  })
}

const USER_COLUMNS = [
  'uid',
  'email',
  'display_name',
  'avatar_url',
  'email_verified',
  'current_org_id',
  'mobile',
  'birth_date',
  'bio',
  'completion_completed',
  'claimed_at',
  'terms_accepted_at',
  'terms_version',
  'privacy_accepted_at',
  'privacy_version',
  'anonymized_at',
  'tax_identity',
  'specialties',
  'created_at',
  'updated_at',
] as const

function userColumnValues(user: User): unknown[] {
  return [
    user.uid,
    user.email,
    user.displayName,
    user.avatarUrl,
    user.emailVerified,
    user.currentOrgId,
    user.mobile,
    user.birthDate,
    user.bio,
    user.completionCompleted,
    user.claimedAt,
    user.termsAcceptedAt,
    user.termsVersion,
    user.privacyAcceptedAt,
    user.privacyVersion,
    user.anonymizedAt,
    user.taxIdentity === null ? null : JSON.stringify(user.taxIdentity),
    user.specialties === null ? null : JSON.stringify(user.specialties),
    user.createdAt,
    user.updatedAt,
  ]
}

const INSERT_PLACEHOLDERS = USER_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')

export async function putUser(user: User): Promise<void> {
  const conflictSet = USER_COLUMNS.filter((c) => c !== 'uid')
    .map((c) => `${c} = EXCLUDED.${c}`)
    .join(', ')
  await getEventStorePool().query(
    `INSERT INTO users (${USER_COLUMNS.join(', ')})
     VALUES (${INSERT_PLACEHOLDERS})
     ON CONFLICT (uid) DO UPDATE SET ${conflictSet}`,
    userColumnValues(user),
  )
}

export async function getUserById(uid: string): Promise<User | null> {
  const res = await getEventStorePool().query<UserRow>('SELECT * FROM users WHERE uid = $1', [uid])
  const row = res.rows[0]
  return row ? rowToUser(row) : null
}

export async function getUsersByIds(
  uids: readonly (string | null | undefined)[],
): Promise<Map<string, User>> {
  const unique = [...new Set(uids.filter((uid): uid is string => Boolean(uid)))]
  if (unique.length === 0) return new Map()
  const res = await getEventStorePool().query<UserRow>('SELECT * FROM users WHERE uid = ANY($1)', [
    unique,
  ])
  return new Map(res.rows.map((row) => [row.uid, rowToUser(row)] as const))
}

export async function findUserByMobile(mobile: string): Promise<User | null> {
  const res = await getEventStorePool().query<UserRow>(
    'SELECT * FROM users WHERE mobile = $1 LIMIT 1',
    [mobile],
  )
  const row = res.rows[0]
  return row ? rowToUser(row) : null
}

export async function patchUser(
  uid: string,
  patch: Record<string, unknown>,
  updatedAt: string,
): Promise<boolean> {
  const cols = Object.keys(patch)
  const assignments = cols.map((c, i) => `${c} = $${i + 2}`)
  assignments.push(`updated_at = $${cols.length + 2}`)
  const params: unknown[] = [uid, ...cols.map((c) => serializePatchValue(patch[c])), updatedAt]
  const res: { rowCount: number | null } = await getEventStorePool().query(
    `UPDATE users SET ${assignments.join(', ')} WHERE uid = $1`,
    params,
  )
  return (res.rowCount ?? 0) > 0
}

function serializePatchValue(value: unknown): unknown {
  if (value !== null && typeof value === 'object') return JSON.stringify(value)
  return value
}

export const USER_TABLE_COLUMNS: readonly string[] = USER_COLUMNS

export type UserQueryRow = UserRow & QueryResultRow
