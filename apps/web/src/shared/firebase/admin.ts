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

const INVALID_SESSION_CODES = new Set([
  'auth/session-cookie-expired',
  'auth/session-cookie-revoked',
  'auth/id-token-expired',
  'auth/id-token-revoked',
  'auth/invalid-session-cookie-duration',
  'auth/argument-error',
  'auth/user-disabled',
  'auth/user-not-found',
])

function isInvalidSessionError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null || !('code' in err)) return false
  const code = err.code
  return typeof code === 'string' && INVALID_SESSION_CODES.has(code)
}

function toSessionUser(decoded: {
  uid: string
  email?: string
  picture?: string
  email_verified?: boolean
  name?: unknown
}): SessionUser {
  const name = typeof decoded.name === 'string' ? decoded.name : null
  return {
    uid: decoded.uid,
    email: decoded.email ?? null,
    displayName: name,
    picture: decoded.picture ?? null,
    emailVerified: decoded.email_verified === true,
  }
}

async function verifyWithRetry(session: string, attempts = 3): Promise<SessionUser> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return toSessionUser(await getAdminAuth().verifySessionCookie(session, true))
    } catch (err) {
      if (isInvalidSessionError(err)) throw err
      lastErr = err
    }
  }
  throw lastErr
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies()
  const session = cookieStore.get(SESSION_COOKIE_NAME)?.value
  if (!session) return null
  try {
    return await verifyWithRetry(session)
  } catch (err) {
    if (isInvalidSessionError(err)) return null
    throw err
  }
}
