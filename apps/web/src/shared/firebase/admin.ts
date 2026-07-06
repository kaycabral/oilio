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

// Firebase Auth error codes (prefixed `auth/`) that mean the session is
// genuinely invalid — the cookie is expired, revoked, malformed, or the user is
// gone. These are the ONLY cases where a null session (→ redirect to /login) is
// correct. Any OTHER thrown error (a network blip reaching the revocation
// backend over the network, an internal/unavailable error) is transient: it says
// nothing about cookie validity, so reading it as "no session" logs a valid user
// out on a hiccup (#1375).
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
}

// Verifies the session cookie with the revocation check (`checkRevoked = true`),
// which reaches the Auth backend over the network. A genuinely invalid cookie
// rethrows immediately (the caller maps it to null → /login); a TRANSIENT failure
// is retried a bounded number of times before giving up. This is the fix for
// #1375: previously any thrown error — including a one-off network blip on the
// revocation call — was swallowed into `null`, logging a valid user out when they
// merely opened Settings. Resilience lives HERE, so the ~50 `getSessionUser`
// call-sites keep their `SessionUser | null` contract unchanged.
async function verifyWithRetry(session: string, attempts = 3): Promise<SessionUser> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return toSessionUser(await getAdminAuth().verifySessionCookie(session, true))
    } catch (err) {
      // A genuinely invalid cookie will never become valid on retry — fail fast.
      if (isInvalidSessionError(err)) throw err
      lastErr = err
    }
  }
  // Exhausted retries on transient failures — rethrow the last one. `null` here
  // would resurrect #1375 (logout on a persistent-but-transient backend outage);
  // a thrown error surfaces as an error boundary, not a silent logout.
  throw lastErr
}

// Resolves the session user, or `null` only when the cookie is absent or
// genuinely invalid (expired/revoked/malformed). A transient verification
// failure is retried internally and, if it still fails, throws — it is never
// silently turned into "no session".
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
