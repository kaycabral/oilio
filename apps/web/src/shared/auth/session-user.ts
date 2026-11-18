export type SessionUser = {
  uid: string
  authUserId: string
  email: string | null
  displayName: string | null
  picture: string | null
  emailVerified: boolean
}

type Metadata = Record<string, unknown> | undefined

export const LEGACY_UID_CLAIM = 'oilio_uid'

function text(metadata: Metadata, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = metadata?.[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return null
}

export function toSessionUser(source: {
  id: string
  email?: string | null
  appMetadata: Metadata
  userMetadata: Metadata
}): SessionUser {
  return {
    uid: text(source.appMetadata, LEGACY_UID_CLAIM) ?? source.id,
    authUserId: source.id,
    email: source.email ?? null,
    displayName: text(source.userMetadata, 'full_name', 'name'),
    picture: text(source.userMetadata, 'avatar_url', 'picture'),
    emailVerified: source.userMetadata?.email_verified === true,
  }
}
