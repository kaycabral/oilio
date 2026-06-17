import { getAdminAuth } from '@/shared/db'
import { cookies } from 'next/headers'
import 'server-only'
import { SESSION_COOKIE_NAME } from './session'

export type SessionUser = {
  uid: string
  email: string | null
  displayName: string | null
  picture: string | null
  emailVerified: boolean
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies()
  const session = cookieStore.get(SESSION_COOKIE_NAME)?.value
  if (!session) return null
  try {
    const decoded = await getAdminAuth().verifySessionCookie(session, true)
    // `name` is a custom claim reached via the token's index signature, typed
    // `any` — narrow it to a string before use.
    const name = typeof decoded.name === 'string' ? decoded.name : null
    return {
      uid: decoded.uid,
      email: decoded.email ?? null,
      displayName: name,
      picture: decoded.picture ?? null,
      emailVerified: decoded.email_verified === true,
    }
  } catch {
    return null
  }
}
