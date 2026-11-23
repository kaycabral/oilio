import 'server-only'

import type { User } from '@/domain'
import { getUserById, patchUser, putUser } from '@/shared/db/pg/users-store'
import type { SessionUser } from './session-user'

export async function upsertUser(session: SessionUser): Promise<void> {
  const now = new Date().toISOString()
  const existing = await getUserById(session.uid)
  if (!existing) {
    const initial: User = {
      uid: session.uid,
      email: session.email,
      displayName: session.displayName,
      avatarUrl: session.picture,
      emailVerified: session.emailVerified,
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
  if (existing.anonymizedAt) return
  const patch: Record<string, unknown> = { email_verified: session.emailVerified }
  if (session.email !== null) patch.email = session.email
  if (session.displayName !== null) patch.display_name = session.displayName
  if (session.picture !== null) patch.avatar_url = session.picture
  await patchUser(session.uid, patch, now)
}
