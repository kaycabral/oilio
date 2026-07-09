import { type Membership, StoredUnit, type Unit } from '@/domain'
import { type UnitRow, rowToDoc } from '@/shared/db/pg/effect/unit-projector'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { Schema } from 'effect'
import { cookies } from 'next/headers'
import 'server-only'

const decodeStoredUnit = Schema.decodeUnknownSync(StoredUnit)

export const ACTIVE_UNIT_COOKIE_NAME = 'activeUnitId'

export const ACTIVE_UNIT_COOKIE_MAX_AGE_S = 60 * 60 * 24 * 365

export type ActiveUnitContext = {
  units: Unit[]
  activeUnitId: string | null
}

export async function needsUnitSelection(membership: Membership): Promise<boolean> {
  if (membership.rlsUnitScope) return false
  const units = await listAccessibleUnits(membership)
  if (units.length < 2) return false
  const cookieStore = await cookies()
  const cookieUnitId = cookieStore.get(ACTIVE_UNIT_COOKIE_NAME)?.value
  return !(cookieUnitId && units.some((u) => u.id === cookieUnitId))
}

export async function listAccessibleUnits(membership: Membership): Promise<Unit[]> {
  const withDefaultPii = (u: StoredUnit): Unit => ({ ...u, mobile: '', email: null })

  const rows = await readUnderRls<UnitRow>(membership.orgId, (client) =>
    client
      .query<UnitRow>('SELECT * FROM units WHERE org_id = $1 ORDER BY name', [membership.orgId])
      .then((res) => res.rows),
  )
  const allUnits = rows
    .map((r) => withDefaultPii(decodeStoredUnit(rowToDoc(r))))
    .filter((u) => !u.archivedAt)

  if (membership.rlsUnitScope) {
    return allUnits.filter((u) => u.id === membership.rlsUnitScope)
  }
  return allUnits
}

export async function resolveActiveUnit(membership: Membership): Promise<ActiveUnitContext> {
  const units = await listAccessibleUnits(membership)

  if (units.length === 0) {
    return { units, activeUnitId: null }
  }

  if (membership.rlsUnitScope) {
    const locked = units.find((u) => u.id === membership.rlsUnitScope)
    return { units, activeUnitId: locked?.id ?? units[0]?.id ?? null }
  }

  const cookieStore = await cookies()
  const cookieUnitId = cookieStore.get(ACTIVE_UNIT_COOKIE_NAME)?.value
  const validCookieUnit =
    cookieUnitId && units.some((u) => u.id === cookieUnitId) ? cookieUnitId : null

  return { units, activeUnitId: validCookieUnit ?? units[0]?.id ?? null }
}
