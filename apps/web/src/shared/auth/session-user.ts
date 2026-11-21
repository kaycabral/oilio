import type { SessionUser as SupabaseSessionUser } from '@cbrl/supabase'
import { sessionUserFromAuthUser, type AuthUserFields } from '@cbrl/supabase'

export type SessionUser = {
  uid: string
  authUserId: string
  email: string | null
  displayName: string | null
  picture: string | null
  emailVerified: boolean
}

export const LEGACY_UID_CLAIM = 'oilio_uid'

export function toSessionUser(user: SupabaseSessionUser): SessionUser {
  const legacyUid = user.appMetadata[LEGACY_UID_CLAIM]
  return {
    uid: typeof legacyUid === 'string' && legacyUid.length > 0 ? legacyUid : user.id,
    authUserId: user.id,
    email: user.email,
    displayName: user.name,
    picture: user.avatarUrl,
    emailVerified: user.emailVerified,
  }
}

export function sessionUserFromSupabaseUser(user: AuthUserFields): SessionUser {
  return toSessionUser(sessionUserFromAuthUser(user))
}
