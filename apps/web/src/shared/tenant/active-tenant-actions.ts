'use server'

import { getAdminFirestore } from '@/shared/db'
import { getSessionUser } from '@/shared/firebase/admin'
import { ACTIVE_UNIT_COOKIE_NAME } from '@/shared/tenant/active-unit'
import { getUserMemberships } from '@/shared/tenant/membership'
import { cookies } from 'next/headers'

export type SetActiveTenantResult = { ok: true } | { ok: false; error: string }

/**
 * Switches the user's active tenant (brief 0029, AC-09). Validates the target
 * against the user's *active* memberships, writes `users/{uid}.currentTenantId`,
 * and RESETS the ephemeral `activeUnitId` cookie so no unit from the previous
 * tenant leaks into the new one — the next render re-resolves the active unit
 * from the new tenant's accessible units (interstitial if 2+, direct if 1).
 *
 * The active-tenant pointer is a property of the user (`currentTenantId`), not a
 * cookie: it persists across devices, mirroring the multi-tenant invariant
 * (apps/oilio/web/CLAUDE.md § Multi-tenant).
 */
export async function setActiveTenant(tenantId: string): Promise<SetActiveTenantResult> {
  const session = await getSessionUser()
  if (!session) return { ok: false, error: 'Not signed in' }
  if (!session.emailVerified) return { ok: false, error: 'Email not verified' }

  const memberships = await getUserMemberships(session.uid)
  if (!memberships.some((m) => m.tenantId === tenantId)) {
    return { ok: false, error: 'Tenant not accessible' }
  }

  await getAdminFirestore()
    .collection('users')
    .doc(session.uid)
    .set({ currentTenantId: tenantId, updatedAt: new Date().toISOString() }, { merge: true })

  // Reset the active-unit context: the previous tenant's unit must never carry
  // over (no leak — AC-09). Deleting the cookie forces `resolveActiveUnit` to
  // fall back to the new tenant's units on the next request.
  const cookieStore = await cookies()
  cookieStore.delete(ACTIVE_UNIT_COOKIE_NAME)

  return { ok: true }
}
