import { listLinkedOrgIds } from '@/shared/identity/org-links'
import { getActiveOrgContext } from '@/shared/org/membership'
import type { Route } from 'next'
import 'server-only'

export async function resolvePostAuthDestination(uid: string): Promise<Route> {
  const ctx = await getActiveOrgContext(uid)
  if (ctx) return '/dashboard'
  const linkedOrgIds = await listLinkedOrgIds(uid)
  if (linkedOrgIds.length > 0) return '/me/appointments'
  return '/onboarding'
}
