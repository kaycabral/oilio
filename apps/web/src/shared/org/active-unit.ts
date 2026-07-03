import { type Membership, StoredUnit, type Unit } from '@/domain'
import { type UnitRow, rowToDoc } from '@/shared/db/pg/effect/unit-projector'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { Schema } from 'effect'
import { cookies } from 'next/headers'
import 'server-only'

const decodeStoredUnit = Schema.decodeUnknownSync(StoredUnit)

// Ephemeral, device-local active-unit cookie (brief 0029, AC-01). NOT persisted
// in the DB — it only scopes the operational surfaces (Agenda, Comandas,
// Bloqueios, Dashboard-hoje) for the current device. The value is validated
// against the org's accessible units on every read, so a stale/forged id
// can never widen access.
export const ACTIVE_UNIT_COOKIE_NAME = 'activeUnitId'

// One year — the cookie is a convenience hint, never a source of truth. It is
// re-validated server-side on every request, so a long TTL is safe.
export const ACTIVE_UNIT_COOKIE_MAX_AGE_S = 60 * 60 * 24 * 365

export type ActiveUnitContext = {
  // All units the member can operate. For a single-unit member
  // (membership.rlsUnitScope set) this is the locked unit only; otherwise every
  // unit of the org, ordered by name.
  units: Unit[]
  // Resolved active unit id, or null when the org has no units yet (the app
  // stays navigable; operational pages render their empty state).
  activeUnitId: string | null
}

/**
 * Whether the member must pick a unit before entering the app (brief 0029,
 * AC-04): the interstitial shows on first access — no valid `activeUnitId`
 * cookie AND 2+ accessible units AND not pinned to a single unit. A single-unit
 * member or a one-unit org never sees it (enters directly).
 *
 * Kept separate from `resolveActiveUnit` (which always falls back to the first
 * unit) so the layout can distinguish "explicitly chosen" from "defaulted".
 */
export async function needsUnitSelection(membership: Membership): Promise<boolean> {
  if (membership.rlsUnitScope) return false
  const units = await listAccessibleUnits(membership)
  if (units.length < 2) return false
  const cookieStore = await cookies()
  const cookieUnitId = cookieStore.get(ACTIVE_UNIT_COOKIE_NAME)?.value
  return !(cookieUnitId && units.some((u) => u.id === cookieUnitId))
}

/**
 * Units the member is allowed to operate. A member locked to a single unit
 * (`membership.rlsUnitScope`) only sees that one; otherwise all org units.
 *
 * Reads are org-scoped (`orgs/{orgId}/units`) — never a
 * cross-org collectionGroup (multi-org invariant).
 */
export async function listAccessibleUnits(membership: Membership): Promise<Unit[]> {
  // The stored `units` projection carries NO PII (mobile/email live in
  // `units_pii`, merged at read time — see unit-read.ts). This selector only
  // needs id/name/archivedAt, so it decodes the stored projection and fills the
  // contact channels with the same neutral defaults `enrichUnits` uses for an
  // absent PII doc (no extra round-trip — the switcher never reads them).
  // Archived units (brief 0033, bug 3 — `archivedAt` set by `deleteUnit`'s
  // soft-delete) MUST drop out of the selector AND of active-unit resolution:
  // a deleted unit must not be switchable to nor operable in. Mirrors
  // `listUnitsForOrg` (unit-read.ts). Filtered in-memory (truthy `archivedAt`)
  // so legacy docs without the field still surface.
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

/**
 * Resolves the active unit for the current request: cookie → validate against
 * accessible units → fall back to the first accessible unit. A single-unit
 * member is always pinned to their locked unit regardless of the cookie.
 *
 * This is the shared server-side resolver promoted from the agenda's local
 * `?unitId=` logic (brief 0029, AC-02). The switcher/interstitial that *writes*
 * the cookie land in sub-issue #1051.
 */
export async function resolveActiveUnit(membership: Membership): Promise<ActiveUnitContext> {
  const units = await listAccessibleUnits(membership)

  if (units.length === 0) {
    return { units, activeUnitId: null }
  }

  // Single-unit member: pinned, cookie ignored.
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
