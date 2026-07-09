import type { User } from '@/domain'
import { getAdminAuth } from '@/shared/db'
import { getUserById, patchUser, putUser } from '@/shared/db/pg/users-store'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { SESSION_COOKIE_MAX_AGE_MS, SESSION_COOKIE_NAME } from '@/shared/firebase/session'
import { readJson } from '@/shared/http'
import { withRequestContext } from '@/shared/lib/request-context'
import { Schema } from 'effect'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

const CreateSessionBodySchema = Schema.Struct({
  idToken: Schema.optional(Schema.String),
})

async function postHandler(request: Request) {
  if (!isFirebaseConfigured()) {
    return NextResponse.json({ error: 'Firebase not configured' }, { status: 503 })
  }

  const body = await readJson(request, Schema.decodeUnknownSync(CreateSessionBodySchema)).catch(
    () => null,
  )
  const idToken = body?.idToken
  if (!idToken) {
    return NextResponse.json({ error: 'Missing idToken' }, { status: 400 })
  }

  const auth = getAdminAuth()
  const decoded = await auth.verifyIdToken(idToken, true)
  const sessionCookie = await auth.createSessionCookie(idToken, {
    expiresIn: SESSION_COOKIE_MAX_AGE_MS,
  })

  const displayName = typeof decoded.name === 'string' ? decoded.name : null
  const avatarUrl = typeof decoded.picture === 'string' ? decoded.picture : null
  await upsertUser(decoded.uid, {
    email: decoded.email ?? null,
    displayName,
    avatarUrl,
    emailVerified: decoded.email_verified === true,
  })

  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE_NAME, sessionCookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_COOKIE_MAX_AGE_MS / 1000,
  })

  return NextResponse.json({ ok: true })
}

async function deleteHandler() {
  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE_NAME)
  return NextResponse.json({ ok: true })
}

export const POST = withRequestContext(postHandler)
export const DELETE = withRequestContext(deleteHandler)

async function upsertUser(
  uid: string,
  defaults: Pick<User, 'email' | 'displayName' | 'avatarUrl' | 'emailVerified'>,
): Promise<void> {
  const now = new Date().toISOString()
  const existing = await getUserById(uid)
  if (!existing) {
    const initial: User = {
      uid,
      email: defaults.email,
      displayName: defaults.displayName,
      avatarUrl: defaults.avatarUrl,
      emailVerified: defaults.emailVerified,
      currentOrgId: null,
      mobile: null,
      birthDate: null,
      taxIdentity: null,
      bio: null,
      specialties: null,
      completionCompleted: false,
      claimedAt: now,
      termsAcceptedAt: null,
      termsVersion: null,
      privacyAcceptedAt: null,
      privacyVersion: null,
      anonymizedAt: null,
      createdAt: now,
      updatedAt: now,
    }
    await putUser(initial)
    return
  }
  const patch: Record<string, unknown> = {
    email_verified: defaults.emailVerified,
  }
  if (defaults.email !== null) patch.email = defaults.email
  if (defaults.displayName !== null) patch.display_name = defaults.displayName
  if (defaults.avatarUrl !== null) patch.avatar_url = defaults.avatarUrl
  await patchUser(uid, patch, now)
}
