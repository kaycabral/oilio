'use server'

import { getAdminFirestore } from '@/shared/db'
import { getSessionUser } from '@/shared/firebase/admin'
import { ACTIVE_UNIT_COOKIE_NAME } from '@/shared/org/active-unit'
import { getUserMemberships } from '@/shared/org/membership'
import { cookies } from 'next/headers'

export type SetActiveOrgResult = { ok: true } | { ok: false; error: string }

/**
 * Switches the user's active org (brief 0029, AC-09). Validates the target
 * against the user's *active* memberships, writes `users/{uid}.currentOrgId`,
 * and RESETS the ephemeral `activeUnitId` cookie so no unit from the previous
 * org leaks into the new one — the next render re-resolves the active unit
 * from the new org's accessible units (interstitial if 2+, direct if 1).
 *
 * The active-org pointer is a property of the user (`currentOrgId`), not a
 * cookie: it persists across devices, mirroring the multi-org invariant
 * (apps/oilio/web/CLAUDE.md § Multi-org).
 */
export async function setActiveOrg(orgId: string): Promise<SetActiveOrgResult> {
  const session = await getSessionUser()
  if (!session) return { ok: false, error: 'Not signed in' }
  if (!session.emailVerified) return { ok: false, error: 'Email not verified' }

  const memberships = await getUserMemberships(session.uid)
  if (!memberships.some((m) => m.orgId === orgId)) {
    return { ok: false, error: 'Org not accessible' }
  }

  await getAdminFirestore()
    .collection('users')
    .doc(session.uid)
    .set({ currentOrgId: orgId, updatedAt: new Date().toISOString() }, { merge: true })

  // Reset the active-unit context: the previous org's unit must never carry
  // over (no leak — AC-09). Deleting the cookie forces `resolveActiveUnit` to
  // fall back to the new org's units on the next request.
  const cookieStore = await cookies()
  cookieStore.delete(ACTIVE_UNIT_COOKIE_NAME)

  return { ok: true }
}
