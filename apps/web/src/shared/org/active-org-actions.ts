'use server'

import { patchUser } from '@/shared/db/pg/users-store'
import { getSessionUser } from '@/shared/firebase/admin'
import { ACTIVE_UNIT_COOKIE_NAME } from '@/shared/org/active-unit'
import { getUserMemberships } from '@/shared/org/membership'
import { cookies } from 'next/headers'

export type SetActiveOrgResult = { ok: true } | { ok: false; error: string }

export async function setActiveOrg(orgId: string): Promise<SetActiveOrgResult> {
  const session = await getSessionUser()
  if (!session) return { ok: false, error: 'Not signed in' }
  if (!session.emailVerified) return { ok: false, error: 'Email not verified' }

  const memberships = await getUserMemberships(session.uid)
  if (!memberships.some((m) => m.orgId === orgId)) {
    return { ok: false, error: 'Org not accessible' }
  }

  await patchUser(session.uid, { current_org_id: orgId }, new Date().toISOString())

  const cookieStore = await cookies()
  cookieStore.delete(ACTIVE_UNIT_COOKIE_NAME)

  return { ok: true }
}
