'use server'

import {
  ACTIVE_UNIT_COOKIE_MAX_AGE_S,
  ACTIVE_UNIT_COOKIE_NAME,
  listAccessibleUnits,
} from '@/shared/org/active-unit'
import { requireOrgCtx } from '@/shared/org/membership'
import { cookies } from 'next/headers'

export type SetActiveUnitResult = { ok: true } | { ok: false; error: string }

export async function setActiveUnit(unitId: string): Promise<SetActiveUnitResult> {
  const result = await requireOrgCtx()
  if (!result.ok) return { ok: false, error: result.error }

  const { membership } = result.ctx
  if (membership.rlsUnitScope) {
    return { ok: false, error: 'Member is locked to a single unit' }
  }

  const units = await listAccessibleUnits(membership)
  if (!units.some((u) => u.id === unitId)) {
    return { ok: false, error: 'Unit not accessible' }
  }

  const cookieStore = await cookies()
  cookieStore.set(ACTIVE_UNIT_COOKIE_NAME, unitId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ACTIVE_UNIT_COOKIE_MAX_AGE_S,
  })

  return { ok: true }
}
