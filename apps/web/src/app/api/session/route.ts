import type { User } from '@/domain'
import { getAdminAuth, getAdminFirestore } from '@/shared/db'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { SESSION_COOKIE_MAX_AGE_MS, SESSION_COOKIE_NAME } from '@/shared/firebase/session'
import { readJson } from '@/shared/http'
import { Schema } from 'effect'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

const CreateSessionBodySchema = Schema.Struct({
  idToken: Schema.optional(Schema.String),
})

export async function POST(request: Request) {
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

  // NOTE(#1029): login/logout são sinais de funil/ativação, não estado de
  // domínio nem auditoria. Saíram do `recordAudit` legado; instrumentar via
  // `track()` quando a telemetria de produto (0026) subir.
  return NextResponse.json({ ok: true })
}

export async function DELETE() {
  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE_NAME)
  return NextResponse.json({ ok: true })
}

async function upsertUser(
  uid: string,
  defaults: Pick<User, 'email' | 'displayName' | 'avatarUrl' | 'emailVerified'>,
): Promise<void> {
  const ref = getAdminFirestore().collection('users').doc(uid)
  const now = new Date().toISOString()
  const snap = await ref.get()
  if (!snap.exists) {
    const initial: User = {
      uid,
      email: defaults.email,
      displayName: defaults.displayName,
      avatarUrl: defaults.avatarUrl,
      emailVerified: defaults.emailVerified,
      currentTenantId: null,
      whatsapp: null,
      birthDate: null,
      taxIdentity: null,
      bio: null,
      specialties: null,
      completionCompleted: false,
      // The session route only runs after Firebase Auth has verified an
      // idToken, so any User doc created here is by definition claimed.
      // (Stubs come from the recepcionista path — see customer-upsert.ts.)
      claimedAt: now,
      termsAcceptedAt: null,
      termsVersion: null,
      privacyAcceptedAt: null,
      privacyVersion: null,
      anonymizedAt: null,
      createdAt: now,
      updatedAt: now,
    }
    await ref.set(initial)
    return
  }
  // Don't clobber existing fields with nulls — the password-auth path on
  // the emulator carries no displayName/avatarUrl, and the wizard's
  // session prefill (#864) relies on these. We only overwrite when the
  // incoming token actually carries a value (OAuth provider populates
  // these). `emailVerified` is always written since it's a state flag.
  const patch: Record<string, unknown> = {
    emailVerified: defaults.emailVerified,
    updatedAt: now,
  }
  if (defaults.email !== null) patch.email = defaults.email
  if (defaults.displayName !== null) patch.displayName = defaults.displayName
  if (defaults.avatarUrl !== null) patch.avatarUrl = defaults.avatarUrl
  await ref.set(patch, { merge: true })
}
