'use client'

import type { Membership, Org, Unit, User } from '@/domain'
import { setActiveOrg as setActiveOrgAction } from '@/shared/org/active-org-actions'
import { setActiveUnit as setActiveUnitAction } from '@/shared/org/active-unit-actions'
import { useRouter } from 'next/navigation'
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'

// Minimal org descriptor for the switcher (brief 0029, AC-09). The full
// Org doc is only loaded for the active one; the others just need id + name.
export type OrgOption = { id: string; name: string }

export type OrgContextValue = {
  user: User
  org: Org
  membership: Membership
  // Orgs the user is an active member of (brief 0029, AC-09). One entry per
  // active membership; drives the org switcher (shown when 2+).
  orgs: OrgOption[]
  // Units the member can operate (brief 0029). For a single-unit member this
  // is the locked unit only; otherwise every unit of the org.
  units: Unit[]
  // Active operational unit, or null when the org has no units yet.
  activeUnitId: string | null
  // Whether the member is pinned to a single unit (membership.unitId set). The
  // switcher hides the unit picker and the interstitial never shows (AC-05).
  unitLocked: boolean
  // Switches the active unit: validates + writes the ephemeral cookie
  // server-side, then refreshes so server components re-render scoped to it.
  // No-op-safe — rejects for single-unit members / inaccessible units.
  setActiveUnit: (unitId: string) => Promise<void>
  // Switches the active org: writes `currentOrgId` + resets the
  // active-unit cookie so the previous org's unit never leaks (AC-09).
  setActiveOrg: (orgId: string) => Promise<void>
}

const OrgContext = createContext<OrgContextValue | null>(null)

export type OrgProviderValue = Omit<OrgContextValue, 'setActiveUnit' | 'setActiveOrg'>

export function OrgProvider({ value, children }: { value: OrgProviderValue; children: ReactNode }) {
  const router = useRouter()

  const setActiveUnit = useCallback(
    async (unitId: string) => {
      if (unitId === value.activeUnitId) return
      const result = await setActiveUnitAction(unitId)
      if (result.ok) {
        router.refresh()
      }
    },
    [router, value.activeUnitId],
  )

  const setActiveOrg = useCallback(
    async (orgId: string) => {
      if (orgId === value.org.id) return
      const result = await setActiveOrgAction(orgId)
      if (result.ok) {
        router.refresh()
      }
    },
    [router, value.org.id],
  )

  const contextValue = useMemo<OrgContextValue>(
    () => ({ ...value, setActiveUnit, setActiveOrg }),
    [value, setActiveUnit, setActiveOrg],
  )

  return <OrgContext.Provider value={contextValue}>{children}</OrgContext.Provider>
}

export function useOrg(): OrgContextValue {
  const ctx = useContext(OrgContext)
  if (!ctx) {
    throw new Error('useOrg called outside OrgProvider')
  }
  return ctx
}
